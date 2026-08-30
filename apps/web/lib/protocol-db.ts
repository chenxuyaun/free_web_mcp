/** Protocol persistence — claims/attestations/challenges/resolutions (V1).
 *
 *  Wraps the optimistic resolution engine (packages/evidence) with SQLite
 *  storage. The engine is a pure state machine; this module loads a claim's
 *  state, applies an operation via the engine, and persists the result.
 */

import type Database from "better-sqlite3";
import {
  applyEmissionCaps,
  arbitrateResolution,
  brierScore,
  canonicalJson,
  expireClaim as engineExpireClaim,
  finalizeResolution,
  logScore,
  sha256,
  submitAttestation,
  submitChallenge,
  DEFAULT_OPTIMISTIC_CONFIG,
  type Attestation,
  type Challenge,
  type ClaimResolution,
  type ClaimResolutionState,
  type ClaimState,
  type OptimisticConfig,
} from "@free-web-mcp/evidence";
type Db = Database.Database;

/** Proper scoring rule for reputation settlement (teacher §9-§10). */
export type ScoringRule = "brier" | "log";

/** Recompute the resolution root (teacher §21: sha256 over attestations +
 *  challenges + outcome, so settlement is recomputable). This is the SINGLE
 *  source of truth — both the finalize route (anchoring) and the verify
 *  route (on-chain check) must use it so the local root always matches. */
export function computeResolutionRoot(state: ClaimResolutionState): string {
  const res = state.resolution;
  if (!res) throw new Error("No resolution to compute a root from");
  const rootInput = {
    attestations: state.attestations.map((a) => ({
      agent: a.agent,
      decision: a.decision,
      confidence: a.confidence,
      stake: a.stake,
      model: a.model ?? null,
      searchProvider: a.searchProvider ?? null,
      sources: a.sources ?? null,
      reputation: a.reputation ?? null,
      slashed: a.slashed ?? false,
    })),
    challenges: state.challenges.map((c) => ({
      challenger: c.challenger,
      bond: c.bond,
      state: c.state,
      challengerWon: c.challengerWon ?? null,
    })),
    result: res.result,
    finalProbability: res.finalProbability,
    method: res.method,
  } as unknown as Parameters<typeof canonicalJson>[0];
  return sha256(canonicalJson(rootInput));
}

// ---------------------------------------------------------------------------
// Schema (idempotent — safe on every open)
// ---------------------------------------------------------------------------

export function ensureProtocolSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      evidence_id         TEXT PRIMARY KEY REFERENCES evidence(id),
      state               TEXT NOT NULL,
      challenge_deadline  INTEGER,
      total_stake_locked  TEXT NOT NULL DEFAULT '0',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attestations (
      id              TEXT PRIMARY KEY,
      evidence_id     TEXT NOT NULL,
      agent           TEXT NOT NULL,
      decision        TEXT NOT NULL,
      confidence      REAL NOT NULL,
      stake           TEXT NOT NULL,
      rationale       TEXT,
      model           TEXT,
      policy          TEXT,
      search_provider TEXT,
      sources         TEXT,
      reputation      REAL,
      created_at      TEXT NOT NULL,
      settled_at      TEXT,
      slashed         INTEGER,
      reward          TEXT
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id             TEXT PRIMARY KEY,
      evidence_id    TEXT NOT NULL,
      challenger     TEXT NOT NULL,
      bond           TEXT NOT NULL,
      reason         TEXT,
      state          TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      resolved_at    TEXT,
      challenger_won INTEGER,
      bond_slashed   INTEGER,
      bond_reward    TEXT
    );

    CREATE TABLE IF NOT EXISTS resolutions (
      id                TEXT PRIMARY KEY,
      evidence_id       TEXT NOT NULL,
      result            INTEGER,
      final_probability REAL NOT NULL,
      method            TEXT NOT NULL,
      tier              TEXT NOT NULL,
      basis             TEXT NOT NULL,
      resolved_at       TEXT NOT NULL,
      tx_hash           TEXT,
      block_number      INTEGER,
      resolution_root   TEXT,
      effective_votes   REAL,
      resolution_policy TEXT,
      resolution_version TEXT
    );
  `);
  // Migration: add effective_votes to existing databases (CREATE TABLE IF NOT
  // EXISTS does not add columns to an already-created table).
  const cols = db.prepare("PRAGMA table_info(resolutions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "effective_votes")) {
    db.exec("ALTER TABLE resolutions ADD COLUMN effective_votes REAL");
  }
  // V24: resolution policy/version metadata
  if (!cols.some((c) => c.name === "resolution_policy")) {
    db.exec("ALTER TABLE resolutions ADD COLUMN resolution_policy TEXT");
  }
  if (!cols.some((c) => c.name === "resolution_version")) {
    db.exec("ALTER TABLE resolutions ADD COLUMN resolution_version TEXT");
  }

  // Migration: add policy / search_provider / sources to attestations
  const attCols = db.prepare("PRAGMA table_info(attestations)").all() as Array<{ name: string }>;
  if (!attCols.some((c) => c.name === "policy")) {
    db.exec("ALTER TABLE attestations ADD COLUMN policy TEXT");
  }
  if (!attCols.some((c) => c.name === "search_provider")) {
    db.exec("ALTER TABLE attestations ADD COLUMN search_provider TEXT");
  }
  if (!attCols.some((c) => c.name === "sources")) {
    db.exec("ALTER TABLE attestations ADD COLUMN sources TEXT");
  }
  if (!attCols.some((c) => c.name === "reputation")) {
    db.exec("ALTER TABLE attestations ADD COLUMN reputation REAL");
  }

  // Migration: challenge bond settlement columns (V6)
  const chlCols = db.prepare("PRAGMA table_info(challenges)").all() as Array<{ name: string }>;
  if (!chlCols.some((c) => c.name === "bond_slashed")) {
    db.exec("ALTER TABLE challenges ADD COLUMN bond_slashed INTEGER");
  }
  if (!chlCols.some((c) => c.name === "bond_reward")) {
    db.exec("ALTER TABLE challenges ADD COLUMN bond_reward TEXT");
  }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

function mapRow(row: {
  state: string;
  challenge_deadline: number | null;
  total_stake_locked: string;
  created_at: string;
  updated_at: string;
}): ClaimResolutionState {
  return {
    id: "", // set by caller
    state: row.state as ClaimState,
    evidenceHash: "",
    attestations: [],
    challenges: [],
    resolution: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    challengeDeadline: row.challenge_deadline,
    totalStakeLocked: row.total_stake_locked,
  };
}

/** Load the full claim state (attestations + challenges + resolution). */
export function loadClaimState(db: Db, evidenceId: string): ClaimResolutionState | null {
  const row = db
    .prepare("SELECT * FROM claims WHERE evidence_id = ?")
    .get(evidenceId) as
    | {
        state: string;
        challenge_deadline: number | null;
        total_stake_locked: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;

  const state = mapRow(row);
  state.id = evidenceId;

  // The on-chain anchor uses the real SHA-256 of the evidence package (the
  // hash column), NOT the display id (e.g. "EV-000012").
  const ev = db
    .prepare("SELECT hash FROM evidence WHERE id = ?")
    .get(evidenceId) as { hash: string } | undefined;
  state.evidenceHash = ev?.hash ?? evidenceId;

  state.attestations = (db
    .prepare(
      "SELECT * FROM attestations WHERE evidence_id = ? ORDER BY created_at ASC",
    )
    .all(evidenceId) as Array<Record<string, unknown>>).map((a) => ({
    id: String(a.id),
    claimId: evidenceId,
    agent: String(a.agent),
    decision: String(a.decision) as Attestation["decision"],
    confidence: Number(a.confidence),
    stake: String(a.stake),
    rationale: a.rationale ? String(a.rationale) : undefined,
    model: a.model ? String(a.model) : undefined,
    policy: a.policy ? String(a.policy) : undefined,
    searchProvider: a.search_provider ? String(a.search_provider) : undefined,
    sources: a.sources ? (JSON.parse(String(a.sources)) as string[]) : undefined,
    reputation: a.reputation === null || a.reputation === undefined ? undefined : Number(a.reputation),
    createdAt: String(a.created_at),
    settledAt: a.settled_at ? String(a.settled_at) : undefined,
    slashed: a.slashed === null ? undefined : Boolean(a.slashed),
    reward: a.reward ? String(a.reward) : undefined,
  }));

  state.challenges = (db
    .prepare(
      "SELECT * FROM challenges WHERE evidence_id = ? ORDER BY created_at ASC",
    )
    .all(evidenceId) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id),
    claimId: evidenceId,
    challenger: String(c.challenger),
    bond: String(c.bond),
    reason: c.reason ? String(c.reason) : undefined,
    state: String(c.state) as Challenge["state"],
    createdAt: String(c.created_at),
    resolvedAt: c.resolved_at ? String(c.resolved_at) : undefined,
    challengerWon: c.challenger_won === null ? undefined : Boolean(c.challenger_won),
    bondSlashed: c.bond_slashed === null ? undefined : Boolean(c.bond_slashed),
    bondReward: c.bond_reward ? String(c.bond_reward) : undefined,
  }));

  const res = db
    .prepare("SELECT * FROM resolutions WHERE evidence_id = ?")
    .get(evidenceId) as
    | {
        result: number | null;
        final_probability: number;
        method: string;
        tier: string;
        basis: string;
        resolved_at: string;
        tx_hash: string | null;
        block_number: number | null;
        resolution_root: string | null;
        id: string;
        effective_votes: number | null;
        resolution_policy: string | null;
        resolution_version: string | null;
      }
    | undefined;
  if (res) {
    state.resolution = {
      id: res.id,
      claimId: evidenceId,
      result: res.result === null ? null : res.result === 1,
      finalProbability: res.final_probability,
      method: res.method as ClaimResolution["method"],
      tier: res.tier as ClaimResolution["tier"],
      basis: JSON.parse(res.basis) as string[],
      resolvedAt: res.resolved_at,
      txHash: res.tx_hash ?? undefined,
      blockNumber: res.block_number ?? undefined,
      resolutionRoot: res.resolution_root ?? undefined,
      effectiveVotes: res.effective_votes ?? undefined,
      resolutionPolicy: res.resolution_policy ?? undefined,
      resolutionVersion: res.resolution_version ?? undefined,
    };
  }

  return state;
}

/** Create a claim row if it doesn't exist (called when evidence is created). */
export function ensureClaimRow(db: Db, evidenceId: string, now = new Date().toISOString()): void {
  db.prepare(
    `INSERT OR IGNORE INTO claims (evidence_id, state, created_at, updated_at)
     VALUES (?, 'OBSERVED', ?, ?)`,
  ).run(evidenceId, now, now);
}

function saveState(db: Db, state: ClaimResolutionState): void {
  db.prepare(
    `UPDATE claims SET state = ?, challenge_deadline = ?, total_stake_locked = ?, updated_at = ?
     WHERE evidence_id = ?`,
  ).run(
    state.state,
    state.challengeDeadline,
    state.totalStakeLocked,
    state.updatedAt,
    state.id,
  );

  // Attestations: upsert
  const upsertAtt = db.prepare(
    `INSERT OR REPLACE INTO attestations
       (id, evidence_id, agent, decision, confidence, stake, rationale, model,
        policy, search_provider, sources, reputation,
        created_at, settled_at, slashed, reward)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of state.attestations) {
    upsertAtt.run(
      a.id,
      state.id,
      a.agent,
      a.decision,
      a.confidence,
      a.stake,
      a.rationale ?? null,
      a.model ?? null,
      a.policy ?? null,
      a.searchProvider ?? null,
      a.sources ? JSON.stringify(a.sources) : null,
      a.reputation ?? null,
      a.createdAt,
      a.settledAt ?? null,
      a.slashed === undefined ? null : a.slashed ? 1 : 0,
      a.reward ?? null,
    );
  }

  // Challenges: upsert
  const upsertChl = db.prepare(
    `INSERT OR REPLACE INTO challenges
       (id, evidence_id, challenger, bond, reason, state, created_at, resolved_at, challenger_won,
        bond_slashed, bond_reward)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of state.challenges) {
    upsertChl.run(
      c.id,
      state.id,
      c.challenger,
      c.bond,
      c.reason ?? null,
      c.state,
      c.createdAt,
      c.resolvedAt ?? null,
      c.challengerWon === undefined ? null : c.challengerWon ? 1 : 0,
      c.bondSlashed === undefined ? null : c.bondSlashed ? 1 : 0,
      c.bondReward ?? null,
    );
  }

  // Resolution: upsert
  if (state.resolution) {
    db.prepare(
      `INSERT OR REPLACE INTO resolutions
         (id, evidence_id, result, final_probability, method, tier, basis,
          resolved_at, tx_hash, block_number, resolution_root, effective_votes,
          resolution_policy, resolution_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      state.resolution.id,
      state.id,
      state.resolution.result === null ? null : state.resolution.result ? 1 : 0,
      state.resolution.finalProbability,
      state.resolution.method,
      state.resolution.tier,
      JSON.stringify(state.resolution.basis),
      state.resolution.resolvedAt,
      state.resolution.txHash ?? null,
      state.resolution.blockNumber ?? null,
      state.resolution.resolutionRoot ?? null,
      state.resolution.effectiveVotes ?? null,
      state.resolution.resolutionPolicy ?? null,
      state.resolution.resolutionVersion ?? null,
    );
  }
}

// ---------------------------------------------------------------------------
// Protocol operations (engine + persistence)
// ---------------------------------------------------------------------------

function withState(
  db: Db,
  evidenceId: string,
  fn: (state: ClaimResolutionState) => ClaimResolutionState,
): ClaimResolutionState {
  const state = loadClaimState(db, evidenceId);
  if (!state) throw new Error(`Claim ${evidenceId} not found — create evidence first`);
  const updated = fn(state);
  saveState(db, updated);
  return updated;
}

function protocolId(prefix: string): string {
  // Date.now() alone collides for calls within the same millisecond (e.g.
  // rapid attestations), which would silently overwrite a row via upsert.
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function attestClaim(
  db: Db,
  evidenceId: string,
  input: Omit<Attestation, "id" | "claimId" | "createdAt">,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
): ClaimResolutionState {
  const now = new Date().toISOString();
  // Snapshot the validator's current reputation (running average of 1−Brier,
  // teacher §9-§10) so the consensus engine can weight by reputation.
  const repRow = db
    .prepare("SELECT reputation FROM validators WHERE address = ?")
    .get(input.agent.toLowerCase()) as { reputation: number } | undefined;
  const reputation = repRow?.reputation ?? 0;

  const att: Attestation = {
    ...input,
    id: protocolId("ATT"),
    claimId: evidenceId,
    createdAt: now,
    reputation,
  };
  return withState(db, evidenceId, (s) => submitAttestation(s, att, config, now));
}

export function challengeClaim(
  db: Db,
  evidenceId: string,
  input: Omit<Challenge, "id" | "claimId" | "createdAt" | "state">,
): ClaimResolutionState {
  const now = new Date().toISOString();
  const chl: Challenge = {
    ...input,
    id: protocolId("CHL"),
    claimId: evidenceId,
    state: "OPEN",
    createdAt: now,
  };
  return withState(db, evidenceId, (s) => submitChallenge(s, chl, now));
}

/** Human-expert arbitration of a DISPUTED claim (V19, L4). Only DISPUTED
 *  claims are arbitrable; the expert's ruling settles attestations and
 *  challenges, then Brier reputation + challenge bonds are settled. */
export function arbitrateClaim(
  db: Db,
  evidenceId: string,
  ruling: { result: boolean; expert: string; rationale?: string },
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
): ClaimResolutionState {
  const now = new Date().toISOString();
  const state = withState(db, evidenceId, (s) => arbitrateResolution(s, ruling, config, now));
  settleBrierReputations(db, state);
  settleChallengeBonds(db, state, config);
  return state;
}

export function finalizeClaim(
  db: Db,
  evidenceId: string,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
  scoringRule: ScoringRule = "brier",
): ClaimResolutionState {
  const now = new Date().toISOString();
  const state = withState(db, evidenceId, (s) => finalizeResolution(s, config, now));
  // V2 scoring: after a resolution, update each attestor's reputation via a
  // strictly proper scoring rule (Brier or Log — teacher §9), rewarding
  // calibration not just correctness.
  settleBrierReputations(db, state, scoringRule);
  // V6: settle challenge bonds — a loser forfeits their bond, a winner gets
  // it back plus a reward; both get reputation updates (teacher's
  // economically-risked judgment: challenges must hurt when wrong).
  settleChallengeBonds(db, state, config);
  return state;
}

/** V25: expire a claim whose challenge window closed without resolution.
 *  Terminal — no stake settlement, nothing anchored; the dispute lapsed. */
export function expireClaim(db: Db, evidenceId: string): ClaimResolutionState {
  const now = new Date().toISOString();
  return withState(db, evidenceId, (s) => engineExpireClaim(s, now));
}

/** V26: collect reward recipients from a resolved/arbitrated claim state.
 *  Returns recipients whose reward > 0 and whose address looks like a valid
 *  0x-40-hex wallet, so the caller can mint on-chain VERI for them. */
export interface RewardRecipient {
  to: string;
  amount: bigint;
  kind: "attestor" | "challenger";
}

export function collectRewardRecipients(state: ClaimResolutionState): RewardRecipient[] {
  const out: RewardRecipient[] = [];
  const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
  for (const att of state.attestations) {
    if (att.reward && BigInt(att.reward) > 0n && isAddress(att.agent)) {
      out.push({ to: att.agent, amount: BigInt(att.reward), kind: "attestor" });
    }
  }
  for (const ch of state.challenges) {
    if (ch.bondReward && BigInt(ch.bondReward) > 0n && isAddress(ch.challenger)) {
      out.push({ to: ch.challenger, amount: BigInt(ch.bondReward), kind: "challenger" });
    }
  }
  return out;
}

/** Update validator reputations using a strictly proper scoring rule
 *  (teacher §9-§10). reputation = running average of the score, so 1.0 =
 *  perfectly calibrated.
 *  - "brier": score = 1 − (p−o)²  (quadratic penalty)
 *  - "log":   score = p(correct)   (exponential penalty; exp(−logScore))
 *  Both are proper scoring rules; log punishes overconfidence harder. */
export function settleBrierReputations(
  db: Db,
  state: ClaimResolutionState,
  rule: ScoringRule = "brier",
): void {
  const result = state.resolution?.result;
  if (result === null || result === undefined) return; // indeterminate — no scoring

  for (const att of state.attestations) {
    if (att.decision === "UNCERTAIN") continue; // no probability commitment
    const score = rule === "log"
      ? Math.exp(-logScore(att.confidence, result)) // p assigned to the true outcome
      : 1 - brierScore(att.confidence, result);

    // Upsert into validators (reuse the existing table so the leaderboard
    // picks it up automatically).
    db.prepare(
      `INSERT INTO validators (address, reputation, verified_claims, successful_challenges, total_votes, created_at)
       VALUES (?, ?, 0, 0, 1, ?)
       ON CONFLICT(address) DO UPDATE SET
         reputation = (reputation * total_votes + ?) / (total_votes + 1),
         total_votes = total_votes + 1`,
    ).run(att.agent.toLowerCase(), score, new Date().toISOString(), score);
  }
}

/** Settle challenge bond economics (V6, teacher's economically-risked judgment).
 *  A winning challenger gets their bond back plus a reward and a reputation
 *  bump; a losing challenger forfeits the bond and gets a reputation hit. */
export function settleChallengeBonds(db: Db, state: ClaimResolutionState, config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG): void {
  for (let i = 0; i < state.challenges.length; i++) {
    const ch = state.challenges[i];
    if (ch.challengerWon === undefined) continue; // not settled

    const won = ch.challengerWon;
    const bond = BigInt(ch.bond);
    // V26: challenger reward also passes through emission caps (per-recipient
    // cap + pool budget) so a single finalize never mints more than the budget.
    const [reward] = applyEmissionCaps(
      [won ? (bond * BigInt(Math.round(config.challengerRewardFraction * 1_000)) / 1000n) : 0n],
      config,
    );
    const rewardStr = reward.toString();
    const slashed = !won;

    // Persist bond outcome on the challenge row + the returned state so the
    // API response reflects the settlement.
    db.prepare("UPDATE challenges SET bond_slashed = ?, bond_reward = ? WHERE id = ?")
      .run(slashed ? 1 : 0, rewardStr, ch.id);
    state.challenges[i] = { ...ch, bondSlashed: slashed, bondReward: rewardStr };

    // Update validator stats: win = +1 successful_challenge, lose = 0
    const challengeScore = won ? 1.0 : 0.0;
    db.prepare(
      `INSERT INTO validators (address, reputation, verified_claims, successful_challenges, total_votes, created_at)
       VALUES (?, ?, 0, ?, 1, ?)
       ON CONFLICT(address) DO UPDATE SET
         reputation = (reputation * total_votes + ?) / (total_votes + 1),
         successful_challenges = successful_challenges + ?,
         total_votes = total_votes + 1`,
    ).run(
      ch.challenger.toLowerCase(),
      challengeScore,
      won ? 1 : 0,
      new Date().toISOString(),
      challengeScore,
      won ? 1 : 0,
    );
  }
}

export function listClaims(db: Db, limit = 50): Array<{
  evidenceId: string;
  state: string;
  attestationCount: number;
  challengeCount: number;
  resolved: boolean;
  updatedAt: string;
}> {
  return (
    db
      .prepare(
        `SELECT c.evidence_id, c.state, c.updated_at,
                (SELECT COUNT(*) FROM attestations a WHERE a.evidence_id = c.evidence_id) AS att_count,
                (SELECT COUNT(*) FROM challenges ch WHERE ch.evidence_id = c.evidence_id) AS chl_count,
                (SELECT COUNT(*) FROM resolutions r WHERE r.evidence_id = c.evidence_id) AS res_count
         FROM claims c ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      evidence_id: string;
      state: string;
      updated_at: string;
      att_count: number;
      chl_count: number;
      res_count: number;
    }>
  ).map((r) => ({
    evidenceId: r.evidence_id,
    state: r.state,
    attestationCount: r.att_count,
    challengeCount: r.chl_count,
    resolved: r.res_count > 0,
    updatedAt: r.updated_at,
  }));
}


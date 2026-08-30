/** Protocol persistence — claims/attestations/challenges/resolutions (V1).
 *
 *  Wraps the optimistic resolution engine (packages/evidence) with SQLite
 *  storage. The engine is a pure state machine; this module loads a claim's
 *  state, applies an operation via the engine, and persists the result.
 */

import type Database from "better-sqlite3";
import {
  brierScore,
  finalizeResolution,
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
      id          TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL,
      agent       TEXT NOT NULL,
      decision    TEXT NOT NULL,
      confidence  REAL NOT NULL,
      stake       TEXT NOT NULL,
      rationale   TEXT,
      model       TEXT,
      created_at  TEXT NOT NULL,
      settled_at  TEXT,
      slashed     INTEGER,
      reward      TEXT
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
      challenger_won INTEGER
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
      resolution_root   TEXT
    );
  `);
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
        created_at, settled_at, slashed, reward)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      a.createdAt,
      a.settledAt ?? null,
      a.slashed === undefined ? null : a.slashed ? 1 : 0,
      a.reward ?? null,
    );
  }

  // Challenges: upsert
  const upsertChl = db.prepare(
    `INSERT OR REPLACE INTO challenges
       (id, evidence_id, challenger, bond, reason, state, created_at, resolved_at, challenger_won)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  }

  // Resolution: upsert
  if (state.resolution) {
    db.prepare(
      `INSERT OR REPLACE INTO resolutions
         (id, evidence_id, result, final_probability, method, tier, basis,
          resolved_at, tx_hash, block_number, resolution_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export function attestClaim(
  db: Db,
  evidenceId: string,
  input: Omit<Attestation, "id" | "claimId" | "createdAt">,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
): ClaimResolutionState {
  const now = new Date().toISOString();
  const att: Attestation = {
    ...input,
    id: `ATT-${Date.now().toString(36)}`,
    claimId: evidenceId,
    createdAt: now,
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
    id: `CHL-${Date.now().toString(36)}`,
    claimId: evidenceId,
    state: "OPEN",
    createdAt: now,
  };
  return withState(db, evidenceId, (s) => submitChallenge(s, chl, now));
}

export function finalizeClaim(
  db: Db,
  evidenceId: string,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
): ClaimResolutionState {
  const now = new Date().toISOString();
  const state = withState(db, evidenceId, (s) => finalizeResolution(s, config, now));
  // V2 scoring: after a resolution, update each attestor's reputation via a
  // strictly proper scoring rule (Brier), rewarding calibration not just
  // correctness (teacher §9).
  settleBrierReputations(db, state);
  return state;
}

/** Update validator reputations using the Brier score of their confidence
 *  against the final resolution outcome (teacher §9-§10).
 *  reputation = running average of (1 - brier) so 1.0 = perfectly calibrated. */
export function settleBrierReputations(db: Db, state: ClaimResolutionState): void {
  const result = state.resolution?.result;
  if (result === null || result === undefined) return; // indeterminate — no scoring

  for (const att of state.attestations) {
    if (att.decision === "UNCERTAIN") continue; // no probability commitment
    const brier = brierScore(att.confidence, result);
    const score = 1 - brier; // 1.0 perfect, 0.0 worst

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


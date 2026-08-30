import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePackage, sha256, type EvidenceSource, type OptimisticConfig } from "@free-web-mcp/evidence";
import { closeDb, getDb, getValidatorStats, insertEvidence } from "../lib/db";
import {
  attestClaim,
  challengeClaim,
  computeResolutionRoot,
  finalizeClaim,
  loadClaimState,
  type ScoringRule,
} from "../lib/protocol-db";

/** Short challenge window so finalize works immediately in tests. */
const FAST: OptimisticConfig = {
  challengeWindowSec: 1,
  challengeBondMultiplier: 1.0,
  attestorRewardFraction: 0.1,
  challengerRewardFraction: 0.1,
  maxAttestations: 10,
};

const tmpDirs: string[] = [];

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwm-protocol-"));
  tmpDirs.push(dir);
  return path.join(dir, "test.db");
}

afterAll(() => {
  closeDb();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeEvidence(dbPath: string): string {
  const src: EvidenceSource = {
    url: "https://example.com/press",
    title: "Press Release",
    sourceType: "official",
    retrievedAt: new Date().toISOString(),
    contentHash: sha256("content"),
  };
  const { pkg, hash } = buildEvidencePackage({
    id: "EV-TEMP",
    claimText: "Company X acquired Company Y in 2026",
    claimType: "event",
    supporting: [src],
    contradicting: [],
    counterEvidence: { claim: "", searches: [], sources: [], found: false },
    crossVerified: true,
  });
  const saved = insertEvidence({ pkg, hash }, dbPath);
  return saved.id; // insertEvidence assigns the real sequential id
}

describe("V1 protocol flow (SQLite-backed)", () => {
  it("evidence creation auto-initializes a claim in OBSERVED state", () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const state = loadClaimState(getDb(dbPath), id);
    expect(state).not.toBeNull();
    expect(state?.state).toBe("OBSERVED");
  });

  it("attest → SUPPORTED with a challenge deadline", () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const state = attestClaim(
      getDb(dbPath),
      id,
      { agent: "0xagent", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" },
    );
    expect(state.state).toBe("SUPPORTED");
    expect(state.challengeDeadline).not.toBeNull();
  });

  it("challenge → CHALLENGED", () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);
    attestClaim(db, id, { agent: "0xagent", decision: "SUPPORTED", confidence: 0.9, stake: "100" });
    const state = challengeClaim(db, id, {
      challenger: "0xchallenger",
      bond: "100",
      reason: "contradicts",
    });
    expect(state.state).toBe("CHALLENGED");
  });

  it("finalize produces a resolution and settles Brier reputation", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);
    const agent = "0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4";
    const conf = 0.9; // high confidence SUPPORTED → outcome TRUE
    attestClaim(db, id, { agent, decision: "SUPPORTED", confidence: conf, stake: "100000000000000000000" }, FAST);

    // let the 1s challenge window close
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.state).toBe("RESOLVED");
    expect(state.resolution?.result).toBe(true);

    // Brier score = (0.9 - 1)^2 = 0.01 → reputation = 1 - 0.01 = 0.99
    const stats = getValidatorStats(agent, dbPath);
    expect(stats).not.toBeNull();
    expect(stats!.reputation).toBeCloseTo(0.99, 5);
    expect(stats!.totalVotes).toBe(1);
  });
});

describe("V2 independence-weighted consensus (SQLite-backed)", () => {
  it("persists effective_votes < raw attestation count for correlated models", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // Two same-model agents say SUPPORTED, one diverse agent says CONTRADICTED.
    // independence: gpt-4o pair → 0.3 each, claude → 1.0. Weighted: 0.3+0.3 vs 1.0
    // → outcome flips to the diverse agent's side.
    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" }, FAST);
    attestClaim(db, id, { agent: "0xccc", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000", model: "claude-sonnet" }, FAST);

    const challenged = challengeClaim(db, id, { challenger: "0xchallenger", bond: "100000000000000000000", reason: "dispute" });
    expect(challenged.state).toBe("CHALLENGED");

    // let the 1s challenge window close
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.state).toBe("RESOLVED");
    expect(state.resolution?.method).toBe("CONSENSUS_VOTE");
    // The diverse claude vote outweighs the correlated gpt-4o pair
    expect(state.resolution?.result).toBe(false);
    expect(state.resolution?.effectiveVotes).toBeCloseTo(1.6, 1);

    // Reload from disk — effective_votes must round-trip through SQLite
    const reloaded = loadClaimState(db, id);
    expect(reloaded?.resolution?.effectiveVotes).toBeCloseTo(1.6, 1);
  });

  it("all-distinct models → effective_votes ≈ raw count", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "SUPPORTED", confidence: 0.8, stake: "100000000000000000000", model: "claude-sonnet" }, FAST);
    attestClaim(db, id, { agent: "0xccc", decision: "CONTRADICTED", confidence: 0.2, stake: "100000000000000000000", model: "gemini-pro" }, FAST);

    challengeClaim(db, id, { challenger: "0xchallenger", bond: "100000000000000000000", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.resolution?.effectiveVotes).toBeCloseTo(3.0, 1);
  });

  it("persists searchProvider + sources and applies them to correlation", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // Three agents share searchProvider but read disjoint pages: correlation
    // from provider = 0.5 each → independence 0.5 each → effective 1.5.
    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", searchProvider: "bing", sources: ["https://a.com"] }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", searchProvider: "bing", sources: ["https://b.com"] }, FAST);
    attestClaim(db, id, { agent: "0xccc", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000", searchProvider: "exa", sources: ["https://c.com"] }, FAST);

    challengeClaim(db, id, { challenger: "0xchallenger", bond: "100000000000000000000", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    // bing-pair: 0.5 + 0.5, exa: 1.0 → 2.0 effective
    expect(state.resolution?.effectiveVotes).toBeCloseTo(2.0, 1);

    // Reload — searchProvider/sources must round-trip
    const reloaded = loadClaimState(db, id);
    const [a1, , a3] = reloaded!.attestations;
    expect(a1.searchProvider).toBe("bing");
    expect(a1.sources).toEqual(["https://a.com"]);
    expect(a3.searchProvider).toBe("exa");
  });

  it("snapshots validator reputation at attest time and persists it", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // First: build reputation for 0xrep via a resolved claim (Brier settle)
    // Simpler: directly seed a validator row with a known reputation.
    const agent = "0x6000000000000000000000000000000000000000";
    db.prepare(
      `INSERT INTO validators (address, reputation, verified_claims, successful_challenges, total_votes, created_at)
       VALUES (?, ?, 5, 1, 6, ?)`,
    ).run(agent, 0.97, new Date().toISOString());

    // Attest — the engine should snapshot reputation=0.97 on the attestation
    const state = attestClaim(db, id, { agent, decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" }, FAST);
    expect(state.attestations[0].reputation).toBeCloseTo(0.97, 5);

    // Persist + reload round-trip
    const reloaded = loadClaimState(db, id);
    expect(reloaded!.attestations[0].reputation).toBeCloseTo(0.97, 5);
  });

  it("persists the escalated oracle-ladder tier on the resolution", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // Knife-edge consensus (0.52 vs 0.48, equal stakes) → L4_HUMAN_EXPERT
    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.52, stake: "100000000000000000000" }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "CONTRADICTED", confidence: 0.48, stake: "100000000000000000000" }, FAST);

    challengeClaim(db, id, { challenger: "0xchallenger", bond: "100000000000000000000", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.resolution?.tier).toBe("L4_HUMAN_EXPERT");

    // Round-trip through SQLite
    const reloaded = loadClaimState(db, id);
    expect(reloaded?.resolution?.tier).toBe("L4_HUMAN_EXPERT");
  });
});

describe("V6 challenge bond settlement (SQLite-backed)", () => {
  it("losing challenger forfeits bond and gets no successful_challenges", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // Challenger bonds against a claim that resolves FALSE → challenger wins
    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" }, FAST);
    const challenger = "0x9999999999999999999999999999999999999999";
    challengeClaim(db, id, { challenger, bond: "50000000000000000000", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.resolution?.result).toBe(true); // SUPPORTED 0.9 alone → TRUE
    const chl = state.challenges[0];
    // Challenger lost (result TRUE, they said FALSE) → bond slashed, no reward
    expect(chl.challengerWon).toBe(false);
    expect(chl.bondSlashed).toBe(true);
    expect(chl.bondReward).toBe("0");

    // Reload — bond outcome persists
    const reloaded = loadClaimState(db, id);
    expect(reloaded?.challenges[0].bondSlashed).toBe(true);

    // Validator stats: challenger has 0 successful challenges
    const stats = getValidatorStats(challenger, dbPath);
    expect(stats?.successfulChallenges).toBe(0);
  });

  it("winning challenger gets bond reward + reputation bump and successful_challenges", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    // Two diverse agents, UNEQUAL stakes for a decisive FALSE (equal stakes
    // at 0.2/0.8 would hit the knife-edge 0.5 → INDETERMINATE under V13):
    //   SUPPORTED 0.2 (large stake) vs CONTRADICTED 0.8 (small stake)
    //   → (0.2×100 + 0.8×50)/150 = 0.4 → FALSE, L2 consensus.
    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.2, stake: "100000000000000000000", model: "gpt-4o" }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "CONTRADICTED", confidence: 0.8, stake: "50000000000000000000", model: "claude" }, FAST);

    const challenger = "0x9999999999999999999999999999999999999999";
    challengeClaim(db, id, { challenger, bond: "50000000000000000000", reason: "the truth is FALSE" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    expect(state.resolution?.result).toBe(false);
    const chl = state.challenges[0];
    expect(chl.challengerWon).toBe(true);
    expect(chl.bondSlashed).toBe(false);
    // challengerRewardFraction 0.1 × bond 50 → 5 VERI reward
    expect(chl.bondReward).toBe("5000000000000000000");

    const stats = getValidatorStats(challenger, dbPath);
    expect(stats?.successfulChallenges).toBe(1);
    expect(stats?.reputation).toBeCloseTo(1.0, 5);
  });
});

describe("V7 resolution-root verification (recomputable root)", () => {
  it("computeResolutionRoot is deterministic and stable across reloads", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" }, FAST);
    attestClaim(db, id, { agent: "0xbbb", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000", model: "claude" }, FAST);
    challengeClaim(db, id, { challenger: "0xchallenger", bond: "100", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    const root1 = computeResolutionRoot(state);
    expect(root1).toMatch(/^[0-9a-f]{64}$/);

    // Reload from SQLite — the root must be recomputable identically
    const reloaded = loadClaimState(db, id);
    expect(reloaded).not.toBeNull();
    const root2 = computeResolutionRoot(reloaded!);
    expect(root2).toBe(root1);
  });

  it("root changes when attestation content changes (detects tampering)", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);

    attestClaim(db, id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" }, FAST);
    challengeClaim(db, id, { challenger: "0xchallenger", bond: "100", reason: "dispute" });
    await new Promise((r) => setTimeout(r, 1100));

    const state = finalizeClaim(db, id, FAST);
    const root1 = computeResolutionRoot(state);

    // Tamper: mutate the first attestation's confidence in memory
    const tampered = loadClaimState(db, id)!;
    tampered.attestations[0].confidence = 0.99;
    const root2 = computeResolutionRoot(tampered);
    expect(root2).not.toBe(root1);
  });
});

describe("V10 proper scoring rules (teacher §9-§10)", () => {
  it("brier and log rules settle different reputations for the same confidence", async () => {
    // Same setup for both rules
    async function finalizeWith(rule: ScoringRule) {
      const dbPath = makeDbPath();
      const id = makeEvidence(dbPath);
      const db = getDb(dbPath);
      const agent = "0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4";
      // confidence 0.9 SUPPORTED → outcome TRUE
      attestClaim(db, id, { agent, decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" }, FAST);
      await new Promise((r) => setTimeout(r, 1100));
      finalizeClaim(db, id, FAST, rule);
      return getValidatorStats(agent, dbPath)!;
    }

    const brier = await finalizeWith("brier");
    const log = await finalizeWith("log");

    // Brier: 1 − (0.9−1)² = 0.99
    expect(brier.reputation).toBeCloseTo(0.99, 5);
    // Log: exp(−log(0.9)) = 0.9 — punishes overconfidence harder
    expect(log.reputation).toBeCloseTo(0.9, 5);
    // Log is strictly harsher than Brier for a 0.9-confident correct answer
    expect(log.reputation).toBeLessThan(brier.reputation);
  });

  it("log rule is exact for a perfectly confident correct answer", async () => {
    const dbPath = makeDbPath();
    const id = makeEvidence(dbPath);
    const db = getDb(dbPath);
    const agent = "0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4";
    attestClaim(db, id, { agent, decision: "SUPPORTED", confidence: 1.0, stake: "100000000000000000000" }, FAST);
    await new Promise((r) => setTimeout(r, 1100));
    finalizeClaim(db, id, FAST, "log");
    const stats = getValidatorStats(agent, dbPath)!;
    // exp(−log(1)) = 1.0
    expect(stats.reputation).toBeCloseTo(1.0, 5);
  });
});

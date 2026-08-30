import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePackage, sha256, type EvidenceSource, type OptimisticConfig } from "@free-web-mcp/evidence";
import { closeDb, getDb, getValidatorStats, insertEvidence } from "../lib/db";
import { attestClaim, challengeClaim, finalizeClaim, loadClaimState } from "../lib/protocol-db";

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

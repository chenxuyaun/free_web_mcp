import { describe, expect, it } from "vitest";
import {
  brierScore,
  logScore,
  nextClaimState,
  canTransition,
  attestationMatchesResolution,
  type Attestation,
} from "../src/protocol";
import {
  submitAttestation,
  submitChallenge,
  finalizeResolution,
  DEFAULT_OPTIMISTIC_CONFIG,
  type OptimisticConfig,
  type ClaimResolutionState,
} from "../src/resolution";

function makeClaim(overrides: Partial<ClaimResolutionState> = {}): ClaimResolutionState {
  return {
    id: "claim-1",
    state: "OBSERVED",
    evidenceHash: "0xabc",
    attestations: [],
    challenges: [],
    resolution: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    challengeDeadline: null,
    totalStakeLocked: "0",
    ...overrides,
  };
}

function makeAttestation(overrides: Partial<Attestation> = {}): Attestation {
  return {
    id: "att-1",
    claimId: "claim-1",
    agent: "0xagent",
    decision: "SUPPORTED",
    confidence: 0.9,
    stake: "100000000000000000000", // 100 VERI
    createdAt: "2026-08-29T01:00:00.000Z",
    ...overrides,
  };
}

describe("claim state machine", () => {
  it("follows the legal DRAFT→OBSERVED→SUPPORTED→RESOLVED→FINAL path", () => {
    let s = nextClaimState("DRAFT", { type: "OBSERVED" });
    expect(s).toBe("OBSERVED");
    s = nextClaimState(s, { type: "ATTESTED" });
    expect(s).toBe("SUPPORTED");
    s = nextClaimState(s, { type: "RESOLVED" });
    expect(s).toBe("RESOLVED");
    s = nextClaimState(s, { type: "FINALIZED" });
    expect(s).toBe("FINAL");
  });

  it("rejects illegal transitions", () => {
    expect(() => nextClaimState("DRAFT", { type: "RESOLVED" })).toThrow();
    expect(() => nextClaimState("SUPPORTED", { type: "FINALIZED" })).toThrow();
    expect(() => nextClaimState("FINAL", { type: "OBSERVED" })).toThrow();
  });

  it("canTransition is reflexive on legal pairs", () => {
    expect(canTransition("OBSERVED", "SUPPORTED")).toBe(true);
    expect(canTransition("SUPPORTED", "CHALLENGED")).toBe(true);
    expect(canTransition("CHALLENGED", "DISPUTED")).toBe(true);
    expect(canTransition("DISPUTED", "RESOLVED")).toBe(true);
    expect(canTransition("OBSERVED", "FINAL")).toBe(false);
  });
});

describe("scoring rules", () => {
  it("brier score rewards accurate probabilities", () => {
    // Perfect prediction: 0
    expect(brierScore(1, true)).toBe(0);
    expect(brierScore(0, false)).toBe(0);
    // Imperfect: 0.5^2 = 0.25
    expect(brierScore(0.5, true)).toBeCloseTo(0.25);
    // A sharp correct prediction beats a timid one
    expect(brierScore(0.95, true)).toBeLessThan(brierScore(0.6, true));
  });

  it("log score is strictly proper (truth-telling is optimal)", () => {
    // If outcome is true, reporting p=0.9 beats p=0.5
    expect(logScore(0.9, true)).toBeLessThan(logScore(0.5, true));
    // Clamps extreme values
    expect(Number.isFinite(logScore(1, true))).toBe(true);
    expect(Number.isFinite(logScore(0, false))).toBe(true);
  });
});

describe("attestation matching", () => {
  it("SUPPORTED matches TRUE, CONTRADICTED matches FALSE", () => {
    expect(attestationMatchesResolution("SUPPORTED", true)).toBe(true);
    expect(attestationMatchesResolution("SUPPORTED", false)).toBe(false);
    expect(attestationMatchesResolution("CONTRADICTED", false)).toBe(true);
    expect(attestationMatchesResolution("CONTRADICTED", true)).toBe(false);
  });

  it("UNCERTAIN and indeterminate are never slashed", () => {
    expect(attestationMatchesResolution("UNCERTAIN", true)).toBeNull();
    expect(attestationMatchesResolution("SUPPORTED", null)).toBeNull();
  });
});

describe("resolution engine", () => {
  const SHORT_WINDOW: OptimisticConfig = {
    ...DEFAULT_OPTIMISTIC_CONFIG,
    challengeWindowSec: 60,
    challengeBondMultiplier: 1.0,
    attestorRewardFraction: 0.1,
    challengerRewardFraction: 0.1,
  };

  it("attestation transitions OBSERVED → SUPPORTED and opens a challenge window", () => {
    const claim = makeClaim();
    const updated = submitAttestation(claim, makeAttestation(), SHORT_WINDOW);
    expect(updated.state).toBe("SUPPORTED");
    expect(updated.challengeDeadline).not.toBeNull();
    expect(updated.attestations).toHaveLength(1);
  });

  it("cannot attest a claim that is already RESOLVED", () => {
    const claim = makeClaim({ state: "RESOLVED" });
    expect(() => submitAttestation(claim, makeAttestation(), SHORT_WINDOW)).toThrow();
  });

  it("optimistic finalize after window closes without challenge", () => {
    const claim = makeClaim();
    const att = makeAttestation({ confidence: 0.9 });
    const attested = submitAttestation(claim, att, SHORT_WINDOW);

    // Simulate 2 minutes later (window = 60s)
    const later = new Date(Date.now() + 120_000).toISOString();
    const resolved = finalizeResolution(attested, SHORT_WINDOW, later);

    expect(resolved.state).toBe("RESOLVED");
    expect(resolved.resolution?.method).toBe("OPTIMISTIC_FINALIZE");
    expect(resolved.resolution?.result).toBe(true);
    expect(resolved.resolution?.finalProbability).toBe(0.9);
  });

  it("cannot finalize while the challenge window is still open", () => {
    const claim = makeClaim();
    const attested = submitAttestation(claim, makeAttestation(), SHORT_WINDOW);
    // Only 30s later, window = 60s
    const soon = new Date(Date.now() + 30_000).toISOString();
    expect(() => finalizeResolution(attested, SHORT_WINDOW, soon)).toThrow();
  });

  it("challenge transitions to CHALLENGED and blocks optimistic finalize", () => {
    const claim = makeClaim();
    const attested = submitAttestation(claim, makeAttestation(), SHORT_WINDOW);
    const challenged = submitChallenge(attested, {
      id: "chl-1",
      claimId: "claim-1",
      challenger: "0xchallenger",
      bond: "100000000000000000000",
      reason: "evidence contradicts",
      state: "OPEN",
      createdAt: "2026-08-29T02:00:00.000Z",
    });
    expect(challenged.state).toBe("CHALLENGED");

    const later = new Date(Date.now() + 120_000).toISOString();
    const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);
    expect(resolved.state).toBe("RESOLVED");
    expect(resolved.resolution?.method).toBe("CONSENSUS_VOTE");
  });

  it("slashes attestations that contradicted the resolution", () => {
    const claim = makeClaim();
    const attestor1 = makeAttestation({ id: "att-1", decision: "SUPPORTED", confidence: 0.8, stake: "100000000000000000000" });
    const attestor2 = makeAttestation({ id: "att-2", decision: "CONTRADICTED", confidence: 0.2, stake: "100000000000000000000" });
    const attested = submitAttestation(claim, attestor1, SHORT_WINDOW);
    const attested2 = submitAttestation(attested, attestor2, SHORT_WINDOW);

    const challenged = submitChallenge(attested2, {
      id: "chl-1",
      claimId: "claim-1",
      challenger: "0xchallenger",
      bond: "100000000000000000000",
      state: "OPEN",
      createdAt: "2026-08-29T02:00:00.000Z",
    });

    const later = new Date(Date.now() + 120_000).toISOString();
    const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);

    // Stake-weighted: 0.8 vs 0.2 (equal stakes) → final probability 0.5 → result FALSE (<=0.5)
    expect(resolved.resolution?.result).toBe(false);
    // attestor1 (SUPPORTED) was wrong → slashed
    expect(resolved.attestations[0].slashed).toBe(true);
    // attestor2 (CONTRADICTED) was right → not slashed
    expect(resolved.attestations[1].slashed).toBe(false);
  });
});

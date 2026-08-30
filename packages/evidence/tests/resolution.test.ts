import {
  describe, expect, it,
} from "vitest";
import {
  attestationCorrelation,
  brierScore,
  canTransition,
  computeIndependence,
  effectiveVotes,
  logScore,
  nextClaimState,
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

// ---------------------------------------------------------------------------
// V2 Independence scoring (teacher §12-§13)
// ---------------------------------------------------------------------------

describe("V2 independence scoring", () => {
  const a = (overrides: Partial<Attestation> = {}): Attestation => ({
    id: "a",
    claimId: "c",
    agent: "agent-A",
    decision: "SUPPORTED",
    confidence: 0.8,
    stake: "100000000000000000000",
    createdAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  });

  describe("attestationCorrelation", () => {
    it("same agent → 1.0 (identical information pipeline)", () => {
      expect(attestationCorrelation(a({ agent: "0xalice" }), a({ agent: "0xalice" }))).toBe(1.0);
    });

    it("same model → 0.7", () => {
      expect(attestationCorrelation(a({ model: "gpt-4" }), a({ agent: "agent-B", model: "gpt-4" }))).toBe(0.7);
    });

    it("same search provider → 0.5 (teacher §13)", () => {
      expect(attestationCorrelation(a({ searchProvider: "duckduckgo" }), a({ agent: "agent-B", searchProvider: "duckduckgo" }))).toBe(0.5);
    });

    it("fully overlapping sources → 0.5 (Jaccard 1.0)", () => {
      const c = attestationCorrelation(
        a({ sources: ["https://a.com/x", "https://b.com/y"] }),
        a({ agent: "agent-B", sources: ["https://a.com/x", "https://b.com/y"] }),
      );
      expect(c).toBeCloseTo(0.5, 5);
    });

    it("partially overlapping sources → scaled by Jaccard", () => {
      const c = attestationCorrelation(
        a({ sources: ["https://a.com/x", "https://b.com/y"] }),
        a({ agent: "agent-B", sources: ["https://a.com/x", "https://c.com/z"] }),
      );
      // Jaccard = 1/3 → 0.5 × 1/3 ≈ 0.1667
      expect(c).toBeCloseTo(0.1667, 3);
    });

    it("trailing slashes are normalized in source overlap", () => {
      const c = attestationCorrelation(
        a({ sources: ["https://a.com/x/"] }),
        a({ agent: "agent-B", sources: ["https://a.com/x"] }),
      );
      expect(c).toBeCloseTo(0.5, 5);
    });

    it("same policy → 0.3", () => {
      expect(attestationCorrelation(a({ policy: "search-v2" }), a({ agent: "agent-B", policy: "search-v2" }))).toBe(0.3);
    });

    it("same model + same search provider + same sources → 1.0 (capped)", () => {
      const c = attestationCorrelation(
        a({ model: "gpt-4", searchProvider: "bing", sources: ["https://a.com/x"] }),
        a({ agent: "agent-B", model: "gpt-4", searchProvider: "bing", sources: ["https://a.com/x"] }),
      );
      expect(c).toBe(1.0);
    });

    it("same model + same policy → 1.0 (capped)", () => {
      const c = attestationCorrelation(
        a({ model: "gpt-4", policy: "search-v2" }),
        a({ agent: "agent-B", model: "gpt-4", policy: "search-v2" }),
      );
      expect(c).toBe(1.0);
    });

    it("different model, provider, sources, policy, agent → 0", () => {
      expect(attestationCorrelation(a({ model: "gpt-4", searchProvider: "bing", sources: ["https://a.com"], policy: "v1" }), a({ agent: "agent-B", model: "claude", searchProvider: "ddg", sources: ["https://b.com"], policy: "v2" }))).toBe(0);
    });
  });

  describe("computeIndependence", () => {
    it("single attestation → fully independent [1.0]", () => {
      expect(computeIndependence([a()])).toEqual([1.0]);
    });

    it("two identical model agents → each 0.3 independent", () => {
      const scores = computeIndependence([
        a({ id: "a1", model: "gpt-4" }),
        a({ id: "a2", agent: "agent-B", model: "gpt-4" }),
      ]);
      expect(scores[0]).toBeCloseTo(0.3, 5);
      expect(scores[1]).toBeCloseTo(0.3, 5);
    });

    it("two fully distinct agents → each 1.0", () => {
      const scores = computeIndependence([
        a({ id: "a1", model: "gpt-4", policy: "v1" }),
        a({ id: "a2", agent: "agent-B", model: "claude", policy: "v2" }),
      ]);
      expect(scores[0]).toBe(1.0);
      expect(scores[1]).toBe(1.0);
    });

    it("three same-model agents → each 0.3 effective", () => {
      const scores = computeIndependence([
        a({ id: "a1", model: "gemini" }),
        a({ id: "a2", agent: "agent-B", model: "gemini" }),
        a({ id: "a3", agent: "agent-C", model: "gemini" }),
      ]);
      // Each correlated with 2 others at 0.7 → independence = 1 - 0.7 = 0.3
      scores.forEach(s => expect(s).toBeCloseTo(0.3, 5));
    });
  });

  describe("effectiveVotes", () => {
    it("5 distinct agents → ~5 effective votes", () => {
      const ev = effectiveVotes([
        a({ id: "a1", agent: "ag1", model: "gpt-4" }),
        a({ id: "a2", agent: "ag2", model: "claude" }),
        a({ id: "a3", agent: "ag3", model: "gemini" }),
        a({ id: "a4", agent: "ag4", model: "llama" }),
        a({ id: "a5", agent: "ag5", model: "mistral" }),
      ]);
      expect(ev).toBeCloseTo(5.0, 5);
    });

    it("3 same-model agents → ~0.9 effective votes (≈3 × 0.3)", () => {
      const ev = effectiveVotes([
        a({ id: "a1", model: "gpt-4" }),
        a({ id: "a2", agent: "agent-B", model: "gpt-4" }),
        a({ id: "a3", agent: "agent-C", model: "gpt-4" }),
      ]);
      expect(ev).toBeCloseTo(0.9, 5);
    });
  });

  describe("consensus weighted by stake × independence", () => {
    const SHORT_WINDOW: OptimisticConfig = {
      ...DEFAULT_OPTIMISTIC_CONFIG,
      challengeWindowSec: 60,
    };

    it("correlated model votes weigh less than diverse ones", () => {
      // Two same-model agents say TRUE (confidence 0.9), one diverse says FALSE (0.1)
      // With straight stake weighting: 2:1 for TRUE → finalProbability ≈ 0.633
      // With independence weighting: the two same-model get 0.3 each, the diverse gets 1.0
      //   effective weight: 2×0.3 vs 1×1.0 → 0.6 vs 1.0 → finalProbability ≈ 0.375
      //   → result FALSE because the diverse agent's vote outweighs the correlated pair
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "gpt-4", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" });
      const a3 = makeAttestation({ id: "att-3", agent: "ag3", model: "claude", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000" });

      const attested = submitAttestation(claim, a1, SHORT_WINDOW);
      const attested2 = submitAttestation(attested, a2, SHORT_WINDOW);
      const attested3 = submitAttestation(attested2, a3, SHORT_WINDOW);

      const challenged = submitChallenge(attested3, {
        id: "chl-1",
        claimId: "claim-1",
        challenger: "0xchallenger",
        bond: "100000000000000000000",
        state: "OPEN",
        createdAt: "2026-08-29T02:00:00.000Z",
      });

      const later = new Date(Date.now() + 120_000).toISOString();
      const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);

      expect(resolved.resolution?.method).toBe("CONSENSUS_VOTE");
      // The diverse agent's independence outweighs the correlated pair
      expect(resolved.resolution?.result).toBe(false);
      expect(resolved.resolution?.effectiveVotes).toBeCloseTo(1.6, 1); // 0.3 + 0.3 + 1.0
      // Raw attestations = 3, but effectiveVotes < 3
      expect(resolved.resolution?.effectiveVotes).toBeLessThan(3);
    });

    it("all diverse agents → effectiveVotes ≈ raw count", () => {
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "SUPPORTED", confidence: 0.8, stake: "100000000000000000000" });
      const a3 = makeAttestation({ id: "att-3", agent: "ag3", model: "gemini", decision: "CONTRADICTED", confidence: 0.2, stake: "100000000000000000000" });

      const attested = submitAttestation(claim, a1, SHORT_WINDOW);
      const attested2 = submitAttestation(attested, a2, SHORT_WINDOW);
      const attested3 = submitAttestation(attested2, a3, SHORT_WINDOW);

      const challenged = submitChallenge(attested3, {
        id: "chl-1",
        claimId: "claim-1",
        challenger: "0xchallenger",
        bond: "100000000000000000000",
        state: "OPEN",
        createdAt: "2026-08-29T02:00:00.000Z",
      });

      const later = new Date(Date.now() + 120_000).toISOString();
      const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);

      expect(resolved.resolution?.effectiveVotes).toBeCloseTo(3.0, 1);
    });
  });

  describe("V3 reputation-weighted consensus (teacher §9-§10)", () => {
    const SHORT_WINDOW: OptimisticConfig = {
      ...DEFAULT_OPTIMISTIC_CONFIG,
      challengeWindowSec: 60,
    };

    it("high-reputation validator's vote outweighs equal-stake newcomers", () => {
      // Three diverse validators, equal stake, all fully independent:
      //   ag1 SUPPORTED 0.9, reputation 0.99 (well-calibrated history)
      //   ag2 SUPPORTED 0.6, reputation 0 (newcomer)
      //   ag3 CONTRADICTED 0.4, reputation 0 (newcomer)
      // Plain stake weighting: (0.9 + 0.6 + 0.4)/3 ≈ 0.633 → TRUE
      // With (1+reputation): (0.9×1.99 + 0.6×1 + 0.4×1)/(1.99+1+1)
      //   = (1.791 + 1.0) / 3.99 ≈ 0.700 → TRUE (same direction, more confident)
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", reputation: 0.99 });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "SUPPORTED", confidence: 0.6, stake: "100000000000000000000", reputation: 0 });
      const a3 = makeAttestation({ id: "att-3", agent: "ag3", model: "gemini", decision: "CONTRADICTED", confidence: 0.4, stake: "100000000000000000000", reputation: 0 });

      const attested = submitAttestation(claim, a1, SHORT_WINDOW);
      const attested2 = submitAttestation(attested, a2, SHORT_WINDOW);
      const attested3 = submitAttestation(attested2, a3, SHORT_WINDOW);

      const challenged = submitChallenge(attested3, {
        id: "chl-1",
        claimId: "claim-1",
        challenger: "0xchallenger",
        bond: "100000000000000000000",
        state: "OPEN",
        createdAt: "2026-08-29T02:00:00.000Z",
      });

      const later = new Date(Date.now() + 120_000).toISOString();
      const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);

      expect(resolved.resolution?.method).toBe("CONSENSUS_VOTE");
      expect(resolved.resolution?.result).toBe(true);
      // (0.9×1.99 + 0.6 + 0.4) / 3.99 ≈ 0.700
      expect(resolved.resolution?.finalProbability).toBeCloseTo(0.700, 2);
    });

    it("reputation can flip the outcome when the calibrated expert disagrees", () => {
      // ag1 SUPPORTED 0.6 rep 0, ag2 SUPPORTED 0.55 rep 0, ag3 CONTRADICTED 0.4 rep 0.99
      // Plain: (0.6+0.55+0.4)/3 ≈ 0.517 → TRUE
      // With rep: (0.6 + 0.55 + 0.4×1.99)/(1+1+1.99) = (1.15+0.796)/3.99 ≈ 0.488 → FALSE
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.6, stake: "100000000000000000000", reputation: 0 });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "SUPPORTED", confidence: 0.55, stake: "100000000000000000000", reputation: 0 });
      const a3 = makeAttestation({ id: "att-3", agent: "ag3", model: "gemini", decision: "CONTRADICTED", confidence: 0.4, stake: "100000000000000000000", reputation: 0.99 });

      const attested = submitAttestation(claim, a1, SHORT_WINDOW);
      const attested2 = submitAttestation(attested, a2, SHORT_WINDOW);
      const attested3 = submitAttestation(attested2, a3, SHORT_WINDOW);

      const challenged = submitChallenge(attested3, {
        id: "chl-1",
        claimId: "claim-1",
        challenger: "0xchallenger",
        bond: "100000000000000000000",
        state: "OPEN",
        createdAt: "2026-08-29T02:00:00.000Z",
      });

      const later = new Date(Date.now() + 120_000).toISOString();
      const resolved = finalizeResolution(challenged, SHORT_WINDOW, later);

      expect(resolved.resolution?.result).toBe(false);
      expect(resolved.resolution?.finalProbability).toBeCloseTo(0.488, 2);
    });

    it("reputation is clamped to [0,1] (no weight amplification exploit)", () => {
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", reputation: 5 });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000", reputation: -3 });

      const attested = submitAttestation(claim, a1, SHORT_WINDOW);
      const attested2 = submitAttestation(attested, a2, SHORT_WINDOW);
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

      // clamped: a1 factor 2.0, a2 factor 1.0 → (0.9×2 + 0.1×1)/3 = 0.633 → TRUE
      expect(resolved.resolution?.result).toBe(true);
      expect(resolved.resolution?.finalProbability).toBeCloseTo(0.633, 3);
    });
  });
});

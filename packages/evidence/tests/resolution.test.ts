import {
  describe, expect, it,
} from "vitest";
import {
  attestationCorrelation,
  brierScore,
  canTransition,
  computeIndependence,
  determineResolutionTier,
  effectiveVotes,
  logitPool,
  logScore,
  nextClaimState,
  attestationMatchesResolution,
  type Attestation,
} from "../src/protocol";
import {
  applyEmissionCaps,
  arbitrateResolution,
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
    // Distinct agents so independence > 0 (same agent → correlation 1.0 →
    // weight 0, which would fall back to knife-edge 0.5).
    // Unequal stakes for a decisive FALSE (not knife-edge):
    //   attestor1 SUPPORTED 0.9 with small stake, attestor2 CONTRADICTED 0.1
    //   with large stake → weighted probability ≈ 0.37 → FALSE.
    const attestor1 = makeAttestation({ id: "att-1", agent: "agent-x", decision: "SUPPORTED", confidence: 0.9, stake: "50000000000000000000" });
    const attestor2 = makeAttestation({ id: "att-2", agent: "agent-y", decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000" });
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

    // Weighted: (0.9×50 + 0.1×100) / 150 ≈ 0.37 → FALSE
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

    it("V27: historicalDependency adds 0.4×avg factor", () => {
      // Both have 0.5 historical agreement → +0.4×0.5 = +0.2
      const c = attestationCorrelation(
        a({ historicalDependency: 0.5 }),
        a({ agent: "agent-B", historicalDependency: 0.5 }),
      );
      expect(c).toBeCloseTo(0.2, 5);
    });

    it("V27: historicalDependency 1.0 + model → capped at 1.0", () => {
      const c = attestationCorrelation(
        a({ historicalDependency: 1.0, model: "gpt-4" }),
        a({ agent: "agent-B", historicalDependency: 1.0, model: "gpt-4" }),
      );
      // 0.7 (model) + 0.4 (historical) = 1.1 → capped at 1.0
      expect(c).toBe(1.0);
    });

    it("V27: historicalDependency only on one side uses the average", () => {
      const c = attestationCorrelation(
        a({ historicalDependency: 0.5 }),
        a({ agent: "agent-B" }), // no historicalDependency
      );
      // avg(0.5, 0) = 0.25 → 0.4×0.25 = 0.1
      expect(c).toBeCloseTo(0.1, 5);
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

    it("reputation weighting pushes a near-knife consensus to DISPUTED (V14)", () => {
      // ag1 SUPPORTED 0.6 rep 0, ag2 SUPPORTED 0.55 rep 0, ag3 CONTRADICTED 0.4 rep 0.99
      // With rep: (0.6 + 0.55 + 0.4×1.99)/(1+1+1.99) ≈ 0.488 → knife-edge.
      // V14: knife-edge does NOT resolve — the claim stays DISPUTED, no one
      // is slashed/rewarded, and the challenge is ESCALATED (bond held).
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

      expect(resolved.state).toBe("DISPUTED");
      expect(resolved.resolution).toBeNull();
      expect(resolved.challenges[0].state).toBe("ESCALATED");
      // No one is settled, slashed or rewarded while the dispute is open
      for (const att of resolved.attestations) {
        expect(att.settledAt).toBeUndefined();
        expect(att.slashed).toBeUndefined();
      }
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

  describe("V4 oracle-ladder tier escalation (teacher §21/§33)", () => {
    const SHORT_WINDOW: OptimisticConfig = {
      ...DEFAULT_OPTIMISTIC_CONFIG,
      challengeWindowSec: 60,
    };
    const challengedClaim = { challenges: [{ state: "OPEN" as const }] };
    const cleanClaim = { challenges: [] };

    it("no challenge → L2_AI_VALIDATORS regardless of probability", () => {
      expect(determineResolutionTier(cleanClaim, 0.9, "CONSENSUS_VOTE")).toBe("L2_AI_VALIDATORS");
      expect(determineResolutionTier(cleanClaim, 0.51, "CONSENSUS_VOTE")).toBe("L2_AI_VALIDATORS");
    });

    it("cryptographic method → L0 regardless of challenges", () => {
      expect(determineResolutionTier(challengedClaim, 0.5, "CRYPTOGRAPHIC")).toBe("L0_CRYPTOGRAPHIC");
    });

    it("challenge + clear consensus (|p−0.5| ≥ 0.1) → L2", () => {
      expect(determineResolutionTier(challengedClaim, 0.62, "CONSENSUS_VOTE")).toBe("L2_AI_VALIDATORS");
      expect(determineResolutionTier(challengedClaim, 0.35, "CONSENSUS_VOTE")).toBe("L2_AI_VALIDATORS");
    });

    it("challenge + high disagreement (|p−0.5| < 0.1) → L3_ECONOMIC_DISPUTE", () => {
      expect(determineResolutionTier(challengedClaim, 0.57, "CONSENSUS_VOTE")).toBe("L3_ECONOMIC_DISPUTE");
      expect(determineResolutionTier(challengedClaim, 0.43, "CONSENSUS_VOTE")).toBe("L3_ECONOMIC_DISPUTE");
    });

    it("challenge + extreme disagreement (|p−0.5| < 0.05) → L4_HUMAN_EXPERT", () => {
      expect(determineResolutionTier(challengedClaim, 0.52, "CONSENSUS_VOTE")).toBe("L4_HUMAN_EXPERT");
      expect(determineResolutionTier(challengedClaim, 0.47, "CONSENSUS_VOTE")).toBe("L4_HUMAN_EXPERT");
    });

    it("knife-edge consensus stays DISPUTED (does not manufacture a resolution)", () => {
      const claim = makeClaim();
      const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.52, stake: "100000000000000000000" });
      const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "CONTRADICTED", confidence: 0.48, stake: "100000000000000000000" });

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
      const disputed = finalizeResolution(challenged, SHORT_WINDOW, later);

      // Knife-edge → DISPUTED, no resolution recorded
      expect(disputed.state).toBe("DISPUTED");
      expect(disputed.resolution).toBeNull();
      expect(disputed.challenges[0].state).toBe("ESCALATED");

      // V14: the dispute is not final — a new independent validator can
      // attest and break the knife-edge decisively.
      const a3 = makeAttestation({ id: "att-3", agent: "ag3", model: "gemini", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000" });
      const reattested = submitAttestation(disputed, a3, SHORT_WINDOW);
      const later2 = new Date(Date.now() + 240_000).toISOString();
      const resolved = finalizeResolution(reattested, SHORT_WINDOW, later2);

      expect(resolved.state).toBe("RESOLVED");
      expect(resolved.resolution?.result).toBe(true);
      // V18: a dispute resolved through the ladder uses market-aggregated
      // probability (log-odds belief pool) — the method is PREDICTION_MARKET.
      expect(resolved.resolution?.method).toBe("PREDICTION_MARKET");
      expect(resolved.resolution?.tier).toBe("L2_AI_VALIDATORS");
      // The challenge finally settles: challenger lost (outcome TRUE)
      expect(resolved.challenges[0].challengerWon).toBe(false);
    });

    it("optimistic finalize without challenge stays L2", () => {
      const claim = makeClaim();
      const attested = submitAttestation(claim, makeAttestation({ confidence: 0.9 }), SHORT_WINDOW);
      const later = new Date(Date.now() + 120_000).toISOString();
      const resolved = finalizeResolution(attested, SHORT_WINDOW, later);
      expect(resolved.resolution?.tier).toBe("L2_AI_VALIDATORS");
    });
  });

  describe("V18 log-odds belief pool (prediction market, teacher §25-§27)", () => {
    it("single entry returns its probability", () => {
      expect(logitPool([{ p: 0.9, w: 1 }])).toBeCloseTo(0.9, 5);
    });

    it("two equal-weight entries average to 0.5", () => {
      expect(logitPool([{ p: 0.9, w: 1 }, { p: 0.1, w: 1 }])).toBeCloseTo(0.5, 5);
    });

    it("strongly weighted entry dominates", () => {
      const p = logitPool([
        { p: 0.9, w: 100 },
        { p: 0.5, w: 1 },
      ]);
      // logit(0.9)=2.197, logit(0.5)=0 → average = 2.197*100/101 ≈ 2.175 → sigmoid ≈ 0.898
      expect(p).toBeGreaterThan(0.89);
      expect(p).toBeLessThan(0.9);
    });

    it("extreme beliefs pull the pool harder than weighted average", () => {
      // Two almost-identical 0.99 and one 0.01:
      // Weighted average: (0.99+0.99+0.01)/3 = 0.663
      // Logit pool: logit(0.99)=4.595, logit(0.01)=-4.595
      //   avg logit = (4.595+4.595-4.595)/3 = 1.532 → sigmoid = 0.822
      // The two strong 0.99 beliefs pull the pool harder in logit space.
      const avg = (0.99 + 0.99 + 0.01) / 3;
      const pool = logitPool([
        { p: 0.99, w: 1 },
        { p: 0.99, w: 1 },
        { p: 0.01, w: 1 },
      ]);
      expect(pool).toBeGreaterThan(avg);
      expect(pool).toBeCloseTo(0.822, 2);
    });

    it("zero-weight entries are ignored", () => {
      const p = logitPool([
        { p: 0.9, w: 0 },
        { p: 0.1, w: 1 },
      ]);
      expect(p).toBeCloseTo(0.1, 5);
    });

    it("empty entries return 0.5 (no information)", () => {
      expect(logitPool([])).toBe(0.5);
    });

    it("negative weight is ignored (treated as ≤ 0)", () => {
      const p = logitPool([{ p: 0.9, w: -5 }, { p: 0.1, w: 1 }]);
      expect(p).toBeCloseTo(0.1, 5);
    });
  });
});

// ---------------------------------------------------------------------------
// V19 Human-expert arbitration (teacher §21/§33, L4)
// ---------------------------------------------------------------------------

describe("V19 human-expert arbitration", () => {
  const SHORT_WINDOW: OptimisticConfig = {
    ...DEFAULT_OPTIMISTIC_CONFIG,
    challengeWindowSec: 60,
  };

  function makeDisputedClaim(): ClaimResolutionState {
    const claim = makeClaim();
    const a1 = makeAttestation({ id: "att-1", agent: "ag1", model: "gpt-4", decision: "SUPPORTED", confidence: 0.52, stake: "100000000000000000000" });
    const a2 = makeAttestation({ id: "att-2", agent: "ag2", model: "claude", decision: "CONTRADICTED", confidence: 0.48, stake: "100000000000000000000" });
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
    return finalizeResolution(challenged, SHORT_WINDOW, later);
  }

  it("only DISPUTED claims are arbitrable", () => {
    const claim = makeClaim();
    expect(() => arbitrateResolution(claim, { result: true, expert: "0xexpert" }, SHORT_WINDOW)).toThrow();
  });

  it("expert ruling TRUE resolves with HUMAN_ARBITRATION, slashing the CONTRADICTED attestor", () => {
    const disputed = makeDisputedClaim();
    expect(disputed.state).toBe("DISPUTED");

    const resolved = arbitrateResolution(disputed, {
      result: true,
      expert: "0xdeadbeef",
      rationale: "Reviewed the primary sources — the claim holds",
    }, SHORT_WINDOW);

    expect(resolved.state).toBe("RESOLVED");
    expect(resolved.resolution?.method).toBe("HUMAN_ARBITRATION");
    expect(resolved.resolution?.tier).toBe("L4_HUMAN_EXPERT");
    expect(resolved.resolution?.result).toBe(true);
    expect(resolved.resolution?.finalProbability).toBe(1);
    expect(resolved.resolution?.basis).toEqual(["0xdeadbeef"]);

    // SUPPORTED correct → not slashed; CONTRADICTED wrong → slashed
    expect(resolved.attestations[0].slashed).toBe(false);
    expect(resolved.attestations[1].slashed).toBe(true);
    // The challenge settles: challenger claimed FALSE, ruling is TRUE → rejected
    expect(resolved.challenges[0].challengerWon).toBe(false);
  });

it("expert ruling FALSE rewards the challenger (UPHELD)", () => {
	    const disputed = makeDisputedClaim();
	    const resolved = arbitrateResolution(disputed, {
	      result: false,
	      expert: "0xdeadbeef",
	      rationale: "The sources do not support the claim",
	    }, SHORT_WINDOW);

	    expect(resolved.resolution?.result).toBe(false);
	    expect(resolved.resolution?.finalProbability).toBe(0);
	    // Challenger claimed FALSE → now upheld
	    expect(resolved.challenges[0].challengerWon).toBe(true);
	  });
	});

	describe("V26 emission caps (per-attestor cap + pool budget)", () => {
	  const CAP_WINDOW: OptimisticConfig = {
	    ...DEFAULT_OPTIMISTIC_CONFIG,
	    challengeWindowSec: 60,
	    challengeBondMultiplier: 1.0,
	    attestorRewardFraction: 0.1,
	    challengerRewardFraction: 0.1,
	  };

	  it("applyEmissionCaps clamps each reward at maxRewardPerAttestorWei", () => {
	    const config = { ...DEFAULT_OPTIMISTIC_CONFIG, maxRewardPerAttestorWei: 100n };
	    const raw = [200n, 50n, 300n, 25n];
	    const capped = applyEmissionCaps(raw, config);
	    // 200 > 100 → 100; 50 ≤ 100 → 50; 300 > 100 → 100; 25 ≤ 100 → 25
	    expect(capped).toEqual([100n, 50n, 100n, 25n]);
	  });

	  it("applyEmissionCaps scales proportionally when budget is exceeded", () => {
	    const config = { ...DEFAULT_OPTIMISTIC_CONFIG, rewardBudgetWei: 100n };
	    const raw = [200n, 200n]; // total 400 → budget 100, scale 0.25×
	    const scaled = applyEmissionCaps(raw, config);
	    expect(scaled[0]).toBe(50n); // 200 * 100 / 400 = 50
	    expect(scaled[1]).toBe(50n);
	  });

	  it("applyEmissionCaps with no cap or budget passes unchanged", () => {
	    const config = { ...DEFAULT_OPTIMISTIC_CONFIG };
	    const raw = [100n, 200n, 300n];
	    expect(applyEmissionCaps(raw, config)).toEqual(raw);
	  });

	  it("cap + budget together: cap then scale", () => {
	    const config = { ...DEFAULT_OPTIMISTIC_CONFIG, maxRewardPerAttestorWei: 150n, rewardBudgetWei: 120n };
	    const raw = [200n, 100n]; // cap → [150n, 100n] total 250 → budget 120, scale 0.48×
	    const [a, b] = applyEmissionCaps(raw, config);
	    expect(a).toBe(72n);  // 150 * 120 / 250 = 72
	    expect(b).toBe(48n);  // 100 * 120 / 250 = 48
	  });

	  it("optimistic finalize with cap limits the attestor reward", () => {
	    const claim = makeClaim();
	    const att = makeAttestation({ stake: "100000000000000000000" }); // 100 VERI
	    const attested = submitAttestation(claim, att, CAP_WINDOW);
	    const config = { ...CAP_WINDOW, maxRewardPerAttestorWei: 1234567890000000000n }; // tiny cap < 10% of 100
	    const later = new Date(Date.now() + 120_000).toISOString();
	    const resolved = finalizeResolution(attested, config, later);
	    const reward = BigInt(resolved.attestations[0].reward ?? "0");
	    expect(reward).toBe(1234567890000000000n); // capped
	  });

	  it("consensus resolution with budget scales rewards proportionally", () => {
	    const claim = makeClaim();
	    const att1 = makeAttestation({ agent: "0x1111111111111111111111111111111111111111", decision: "SUPPORTED", confidence: 0.9, stake: "50000000000000000000" });
	    const att2 = makeAttestation({ id: "att-2", agent: "0x2222222222222222222222222222222222222222", decision: "SUPPORTED", confidence: 0.8, stake: "50000000000000000000" });
	    const attested = submitAttestation(claim, att1, CAP_WINDOW);
	    const attested2 = submitAttestation(attested, att2, CAP_WINDOW);
	    // Challenge to force consensus path
	    const challenged = submitChallenge(attested2, { id: "chl-1", claimId: "claim-1", challenger: "0xchal", bond: "10000000000000000000", state: "OPEN", createdAt: "2026-08-29T00:00:00.000Z" });
	    const later = new Date(Date.now() + 120_000).toISOString();
	    // Budget: 10% of 50+50 = 10 VERI, but budget only 2 VERI → scale
	    const config = { ...CAP_WINDOW, rewardBudgetWei: 2000000000000000000n };
	    const resolved = finalizeResolution(challenged, config, later);
	    const r1 = BigInt(resolved.attestations[0].reward ?? "0");
	    const r2 = BigInt(resolved.attestations[1].reward ?? "0");
	    // raw = 5e18 each, sum = 1e19, budget = 2e18 → scale 0.2×
	    expect(r1).toBe(1000000000000000000n);
	    expect(r2).toBe(1000000000000000000n);
	  });
	});

/** V1 Optimistic Resolution Engine — manages claim lifecycle, attestation
 *  staking, challenge windows, and finalization.
 *
 *  Teacher's V1 flow:
 *    Evidence → Claim → Independent Validator → Stake → Challenge Period
 *      → Finalization → Reward / Slash
 *
 *  Design: the engine is a pure-function state machine that computes the
 *  next state of a claim given attestations, challenges, and time. The
 *  actual side-effects (mint/slash VERI, anchor on-chain, write to DB)
 *  are the caller's responsibility so the engine stays testable.
 */

import {
  type Attestation,
  type Challenge,
  type ChallengeState,
  type ClaimResolution,
  type ClaimState,
  attestationMatchesResolution,
  computeIndependence,
  determineResolutionTier,
  logitPool,
} from "./protocol";
import { canonicalJson, merkleRoot, sha256 } from "./hash";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OptimisticConfig {
  /** Challenge window duration in seconds (default: 24h). */
  challengeWindowSec: number;
  /** Minimum bond for a challenge (as fraction of the original attestation stake,
   *  e.g., 1.0 = same as the attestation stake). */
  challengeBondMultiplier: number;
  /** Reward fraction for the correct attestor: e.g., 0.1 = 10% of their stake. */
  attestorRewardFraction: number;
  /** Reward fraction for a successful challenger: e.g., 0.1 = 10% of bond. */
  challengerRewardFraction: number;
  /** Maximum number of attestations for a single claim (to prevent spam). */
  maxAttestations: number;
  /** V26 emission cap: max VERI (wei) minted to a single attestor/challenger
   *  per settlement. 0 (default) = uncapped, fraction-only. */
  maxRewardPerAttestorWei?: bigint;
  /** V26 emission budget: total VERI (wei) minted per finalize across the
   *  reward pool. When the pool exceeds the budget, every reward scales down
   *  proportionally. 0 (default) = unlimited. */
  rewardBudgetWei?: bigint;
}

export const DEFAULT_OPTIMISTIC_CONFIG: OptimisticConfig = {
  challengeWindowSec: 86_400, // 24h
  challengeBondMultiplier: 1.0, // challenger must match the stake
  attestorRewardFraction: 0.1, // 10% of stake minted as reward
  challengerRewardFraction: 0.1, // 10% of bond minted as reward
  maxAttestations: 10,
};

/** V26 emission caps: clamp each reward at maxRewardPerAttestorWei, then if
 *  the total pool exceeds rewardBudgetWei, scale every reward down
 *  proportionally so a single finalize can never emit more than the budget.
 *  Pure function — the caller decides what to mint. */
export function applyEmissionCaps(rewards: bigint[], config: OptimisticConfig): bigint[] {
  const cap = config.maxRewardPerAttestorWei ?? 0n;
  const budget = config.rewardBudgetWei ?? 0n;

  let out = rewards;
  if (cap > 0n) {
    out = out.map((r) => (r > cap ? cap : r));
  }

  const total = out.reduce((s, r) => s + r, 0n);
  if (budget > 0n && total > budget) {
    out = out.map((r) => (r * budget) / total);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Claim state machine — the resolution engine
// ---------------------------------------------------------------------------

export interface ClaimResolutionState {
  id: string;
  state: ClaimState;
  evidenceHash: string;
  attestations: Attestation[];
  challenges: Challenge[];
  resolution: ClaimResolution | null;
  createdAt: string; // ISO-8601
  updatedAt: string;
  /** The challenge window deadline (UTC epoch seconds). */
  challengeDeadline: number | null;
  /** Total VERI locked in attestation stakes. */
  totalStakeLocked: string; // wei
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Submit an attestation (validator judgment with stake).
 *  The first attestation transitions the claim from OBSERVED to SUPPORTED and
 *  starts the challenge window. A DISPUTED claim may keep accepting
 *  attestations (V14): the dispute is not final until a decisive consensus
 *  appears, so more independent validators can weigh in. */
export function submitAttestation(
  claim: ClaimResolutionState,
  attestation: Attestation,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  if (claim.state !== "OBSERVED" && claim.state !== "SUPPORTED" && claim.state !== "DISPUTED") {
    throw new Error(
      `Cannot attest claim in state ${claim.state}`,
    );
  }
  if (claim.attestations.length >= config.maxAttestations) {
    throw new Error("Max attestations reached");
  }
  if (attestation.confidence < 0 || attestation.confidence > 1) {
    throw new Error("Confidence must be in [0, 1]");
  }

  const updated = { ...claim };
  updated.attestations = [...updated.attestations, attestation];
  updated.updatedAt = now;

  // First attestation: start the challenge window
  if (claim.state === "OBSERVED") {
    updated.state = "SUPPORTED";
    const deadline = Math.floor(new Date(now).getTime() / 1000) + config.challengeWindowSec;
    updated.challengeDeadline = deadline;
  }

  return updated;
}

/** Submit a challenge against a claim.
 *  Transitions to CHALLENGED. The challenger must bond VERI.
 *  CHALLENGED → if the challenge window expires without resolution → RESOLVED.
 *  For V1, CHALLENGED means the claim has active disputes.
 */
export function submitChallenge(
  claim: ClaimResolutionState,
  challenge: Challenge,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  if (claim.state !== "SUPPORTED") {
    throw new Error(`Cannot challenge claim in state ${claim.state}`);
  }

  const updated = { ...claim };
  updated.challenges = [...updated.challenges, challenge];
  updated.state = "CHALLENGED";
  updated.updatedAt = now;
  return updated;
}

/** Finalize the claim and produce a resolution.
 *  Handles:
 *  1. SUPPORTED + window closed → OPTIMISTIC_FINALIZE (no challenge).
 *  2. CHALLENGED → consensus vote; knife-edge → DISPUTED (V14).
 *  3. DISPUTED → re-run consensus; if still knife-edge stays DISPUTED,
 *     else resolves. */
export function finalizeResolution(
  claim: ClaimResolutionState,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  const timestamp = new Date(now).getTime() / 1000;
  if (claim.state === "SUPPORTED" && claim.challengeDeadline) {
    if (timestamp < claim.challengeDeadline) {
      throw new Error("Challenge window has not closed yet");
    }
    return optimisticFinalize(claim, config, now);
  }

  if (claim.state === "CHALLENGED" || claim.state === "DISPUTED") {
    return consensusResolution(claim, config, now);
  }

  throw new Error(`Cannot finalize claim in state ${claim.state}`);
}

// ---------------------------------------------------------------------------
// Internal resolution methods
// ---------------------------------------------------------------------------

function optimisticFinalize(
  claim: ClaimResolutionState,
  config: OptimisticConfig,
  now: string,
): ClaimResolutionState {
  // The first attestation's confidence becomes the final probability
  const firstAttestation = claim.attestations[0];
  if (!firstAttestation) throw new Error("No attestation to finalize from");

  const result = firstAttestation.decision === "SUPPORTED";
  const resolution: ClaimResolution = {
    id: `RES-${claim.id}`,
    claimId: claim.id,
    result,
    finalProbability: firstAttestation.confidence,
    method: "OPTIMISTIC_FINALIZE",
    tier: determineResolutionTier(claim, firstAttestation.confidence, "OPTIMISTIC_FINALIZE"),
    basis: [firstAttestation.id],
    resolvedAt: now,
    effectiveVotes: 1, // single independent attestation
    resolutionPolicy: "optimistic-v1", // unchallenged single-attestor fast path
    resolutionVersion: "1.0",
  };

  // V26: an unchallenged finalize still settles the attestor — mark the
  // attestation settled with its (capped) reward so the route can mint VERI.
  const rawRewards = claim.attestations.map((att) =>
    attestationMatchesResolution(att.decision, result) === true
      ? (BigInt(att.stake) * BigInt(Math.round(config.attestorRewardFraction * 1_000)) / 1000n)
      : 0n,
  );
  const rewards = applyEmissionCaps(rawRewards, config);
  const updatedAttestations = claim.attestations.map((att, i) => {
    const matches = attestationMatchesResolution(att.decision, result);
    return {
      ...att,
      settledAt: now,
      slashed: matches === false,
      reward: rewards[i].toString(),
    };
  });

  return {
    ...claim,
    state: "RESOLVED",
    attestations: updatedAttestations,
    resolution,
    updatedAt: now,
  };
}

function consensusResolution(
  claim: ClaimResolutionState,
  config: OptimisticConfig,
  now: string,
): ClaimResolutionState {
  // V2 (teacher §12-§13): weight each attestation by stake × independence.
  // Attestations sharing the same model/policy are correlated — their votes
  // count for less, so 100 same-model agents weigh less than 5 diverse ones.
  const independence = computeIndependence(claim.attestations);
  const IND_SCALE = 1_000_000n; // fixed-point scale for independence ∈ [0,1]

  let totalWeight = 0n;
  let weightedSum = 0n;
  let effectiveVotes = 0;

  for (let i = 0; i < claim.attestations.length; i++) {
    const att = claim.attestations[i];
    const ind = independence[i];
    // V3 (teacher §9-§10): calibrated validators get more influence.
    // reputation ∈ [0,1] (running average of 1−Brier), so a perfect
    // validator carries 2× a brand-new one; missing reputation = 0 (neutral).
    const rep = att.reputation ?? 0;
    const repFactor = 1_000_000n + BigInt(Math.round(Math.min(1, Math.max(0, rep)) * 1_000_000));
    // influence = stake × independence × (1 + reputation), all in fixed point
    const weight = (BigInt(att.stake) * BigInt(Math.round(ind * 1_000_000)) / IND_SCALE) * repFactor / IND_SCALE;
    const scaled = BigInt(Math.round(att.confidence * 1_000_000));
    weightedSum += weight * scaled;
    totalWeight += weight;
    effectiveVotes += ind;
  }

  let finalProbability = totalWeight > 0n
    ? Number(weightedSum) / Number(totalWeight) / 1_000_000
    : 0.5;

  // V18 (teacher §25-§27: L3 economic dispute = prediction market): when a
  // claim that went through the ladder (DISPUTED) finally reaches a decisive
  // consensus, the final probability is the LOG-ODDS belief pool — each
  // validator's stake-weighted confidence aggregated in logit space, the way
  // a prediction market prices an outcome — not a plain weighted average.
  const fromDispute = claim.state === "DISPUTED";
  if (fromDispute) {
    const entries = claim.attestations.map((att, i) => {
      const rep = Math.min(1, Math.max(0, att.reputation ?? 0));
      // stake scaled to VERI units so the weight stays in float precision
      const stakeVeri = Number(BigInt(att.stake) / 10n ** 18n);
      return { p: att.confidence, w: stakeVeri * independence[i] * (1 + rep) };
    });
    finalProbability = logitPool(entries);
  }

  // V13 (teacher §21/§33 oracle ladder): a knife-edge dispute is NOT a
  // resolution. When the weighted consensus lands in the disputed band
  // (|p−0.5| < 0.1 → L3, < 0.05 → L4), a coin-flip at 0.5 would manufacture
  // certainty — instead the claim escalates: outcome is INDETERMINATE until
  // the next, more expensive tier (prediction market / human expert) decides.
  const tier = determineResolutionTier(claim, finalProbability, fromDispute ? "PREDICTION_MARKET" : "CONSENSUS_VOTE");
  const escalated = tier === "L3_ECONOMIC_DISPUTE" || tier === "L4_HUMAN_EXPERT";
  const result: boolean | null = escalated ? null : finalProbability > 0.5;
  const method: ClaimResolution["method"] = escalated
    ? tier === "L4_HUMAN_EXPERT"
      ? "HUMAN_ARBITRATION"
      : "PREDICTION_MARKET"
    : fromDispute
      ? "PREDICTION_MARKET" // L3 economic dispute resolved by market aggregation
      : "CONSENSUS_VOTE";

  // Mark attestations as correct or incorrect (indeterminate → no slash,
  // no reward — matches attestationMatchesResolution(null) = null).
  // V26: raw rewards pass through emission caps (per-attestor cap + pool
  // budget) so a single finalize can never mint more than the budget.
  const rawRewards = claim.attestations.map((att) =>
    attestationMatchesResolution(att.decision, result) === true
      ? (BigInt(att.stake) * BigInt(Math.round(config.attestorRewardFraction * 1_000)) / 1000n)
      : 0n,
  );
  const rewards = applyEmissionCaps(rawRewards, config);
  const updatedAttestations = claim.attestations.map((att, i) => {
    const matches = attestationMatchesResolution(att.decision, result);
    return {
      ...att,
      settledAt: now,
      slashed: matches === false,
      reward: rewards[i].toString(),
    };
  });

  const updatedChallenges = claim.challenges.map((ch) => {
    // OPEN (first dispute) and ESCALATED (a re-finalize of a DISPUTED claim)
    // both settle once the consensus is decisive.
    if (ch.state === "OPEN" || (ch.state === "ESCALATED" && !escalated)) {
      if (escalated) {
        // Dispute too sharp for this layer — escalate; bond stays held.
        return {
          ...ch,
          state: "ESCALATED" as ChallengeState,
          resolvedAt: now,
        };
      }
      // The challenger's claim is "the attestation is wrong"
      const challengerWon = !result; // If the outcome is false, challenger wins
      return {
        ...ch,
        state: (challengerWon ? "UPHELD" : "REJECTED") as ChallengeState,
        challengerWon,
        resolvedAt: now,
      };
    }
    return ch;
  });

  const resolution: ClaimResolution = {
    id: `RES-${claim.id}`,
    claimId: claim.id,
    result,
    finalProbability,
    method,
    tier,
    basis: escalated ? [] : updatedAttestations.filter((a) => !a.slashed).map((a) => a.id),
    resolvedAt: now,
    effectiveVotes: Math.round(effectiveVotes * 1000) / 1000, // Σ independence
    resolutionPolicy: fromDispute ? "logit-market" : "consensus-vote",
    resolutionVersion: "1.0",
  };

  // V14: a knife-edge dispute is NOT a terminal resolution. The claim stays
  // DISPUTED (no resolution recorded) so more independent validators can
  // attest and a decisive consensus can emerge — "higher tier = higher cost,
  // higher finality" (teacher §21/§33). Attestations remain UNSETTLED (still
  // in play for the next round); challenges are marked ESCALATED (bond held).
  if (escalated) {
    return {
      ...claim,
      state: "DISPUTED",
      attestations: claim.attestations, // unchanged — not settled yet
      challenges: claim.challenges.map((ch) =>
        ch.state === "OPEN" ? { ...ch, state: "ESCALATED" as ChallengeState, resolvedAt: now } : ch,
      ),
      resolution: null,
      updatedAt: now,
    };
  }

  return {
    ...claim,
    state: "RESOLVED",
    attestations: updatedAttestations,
    challenges: updatedChallenges,
    resolution,
    updatedAt: now,
  };
}

/** Check if a claim is in a terminal state. */
export function isTerminal(state: ClaimState): boolean {
  return state === "RESOLVED" || state === "FINAL" || state === "EXPIRED";
}

/** Expire a claim whose challenge window closed without a resolution
 *  (V25). SUPPORTED and CHALLENGED claims that are past their deadline and
 *  have no resolution become EXPIRED — a terminal state where no stake is
 *  settled and nothing is anchored: the dispute simply lapsed. */
export function expireClaim(
  claim: ClaimResolutionState,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  if (claim.state !== "SUPPORTED" && claim.state !== "CHALLENGED") {
    throw new Error(`Cannot expire claim in state ${claim.state} — only SUPPORTED/CHALLENGED`);
  }
  if (claim.resolution) {
    throw new Error("Cannot expire a claim that is already resolved");
  }
  if (claim.challengeDeadline === null) {
    throw new Error("Claim has no challenge deadline — cannot expire");
  }
  const nowSec = Math.floor(new Date(now).getTime() / 1000);
  if (nowSec < claim.challengeDeadline) {
    throw new Error("Challenge window has not closed yet");
  }
  return {
    ...claim,
    state: "EXPIRED",
    updatedAt: now,
  };
}

/** Human-expert arbitration of a DISPUTED claim (L4, teacher §21/§33).
 *  When the AI-validator ladder cannot reach a decisive consensus
 *  (knife-edge), a human expert adjudicates: they state the outcome and a
 *  rationale, and the resolution is produced with method HUMAN_ARBITRATION
 *  and tier L4_HUMAN_EXPERT. Attestations settle against the ruling. */
export function arbitrateResolution(
  claim: ClaimResolutionState,
  ruling: {
    result: boolean;
    expert: string; // human expert id / wallet
    rationale?: string;
  },
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  if (claim.state !== "DISPUTED") {
    throw new Error(`Cannot arbitrate claim in state ${claim.state} — only DISPUTED claims are arbitrable`);
  }

  const result = ruling.result;
  // V26: raw rewards pass through emission caps (per-attestor cap + pool
  // budget) so an arbitration can never mint more than the budget.
  const rawRewards = claim.attestations.map((att) =>
    attestationMatchesResolution(att.decision, result) === true
      ? (BigInt(att.stake) * BigInt(Math.round(config.attestorRewardFraction * 1_000)) / 1000n)
      : 0n,
  );
  const rewards = applyEmissionCaps(rawRewards, config);
  const updatedAttestations = claim.attestations.map((att, i) => {
    const matches = attestationMatchesResolution(att.decision, result);
    return {
      ...att,
      settledAt: now,
      slashed: matches === false,
      reward: rewards[i].toString(),
    };
  });

  const updatedChallenges = claim.challenges.map((ch) => {
    if (ch.state === "OPEN" || ch.state === "ESCALATED") {
      const challengerWon = !result;
      return {
        ...ch,
        state: (challengerWon ? "UPHELD" : "REJECTED") as ChallengeState,
        challengerWon,
        resolvedAt: now,
      };
    }
    return ch;
  });

  const resolution: ClaimResolution = {
    id: `RES-${claim.id}`,
    claimId: claim.id,
    result,
    finalProbability: result ? 1 : 0, // expert ruling is definitive
    method: "HUMAN_ARBITRATION",
    tier: "L4_HUMAN_EXPERT",
    basis: [ruling.expert], // the expert's ruling drives the outcome
    resolvedAt: now,
    effectiveVotes: Math.round(computeIndependence(claim.attestations).reduce((sum, v) => sum + v, 0) * 1000) / 1000,
    resolutionPolicy: "human-arbitration", // L4 expert adjudication
    resolutionVersion: "1.0",
  };

  return {
    ...claim,
    state: "RESOLVED",
    attestations: updatedAttestations,
    challenges: updatedChallenges,
    resolution,
    updatedAt: now,
  };
}
// ---------------------------------------------------------------------------
// Merkle resolution root (teacher §21)
// ---------------------------------------------------------------------------

/** Project an attestation to the whitelisted fields that are committed to
 *  the Merkle tree. Deterministic — the same attestation always produces the
 *  same leaf regardless of SQLite round-trip ordering of optional fields. */
export function attestationLeaf(att: Attestation): string {
  const leafInput = {
    agent: att.agent,
    decision: att.decision,
    confidence: att.confidence,
    stake: att.stake,
    model: att.model ?? null,
    searchProvider: att.searchProvider ?? null,
    sources: att.sources ?? null,
    reputation: att.reputation ?? null,
    slashed: att.slashed ?? false,
  };
  return sha256(canonicalJson(leafInput as unknown as Parameters<typeof canonicalJson>[0]));
}

/** Project a challenge to its committed leaf. */
export function challengeLeaf(ch: Challenge): string {
  const leafInput = {
    challenger: ch.challenger,
    bond: ch.bond,
    state: ch.state,
    challengerWon: ch.challengerWon ?? null,
  };
  return sha256(canonicalJson(leafInput as unknown as Parameters<typeof canonicalJson>[0]));
}

/** The outcome (resolution result) leaf — commits result + probability +
 *  method so the root binds the final truth outcome too. */
export function outcomeLeaf(res: ClaimResolution): string {
  const leafInput = {
    result: res.result,
    finalProbability: res.finalProbability,
    method: res.method,
  };
  return sha256(canonicalJson(leafInput as unknown as Parameters<typeof canonicalJson>[0]));
}

/** Compute the Merkle resolution root (teacher §21): leaves are the
 *  per-attestation, per-challenge and outcome hashes, ordered
 *  attestations (created ASC) → challenges (created ASC) → outcome.
 *  Deterministic and recomputable — any single leaf change flips the root,
 *  and a proof can verify one attestation without revealing the rest. */
export function computeMerkleRoot(state: ClaimResolutionState): string {
  const res = state.resolution;
  if (!res) throw new Error("No resolution to compute a root from");
  const leaves = [
    ...state.attestations.map((a) => attestationLeaf(a)),
    ...state.challenges.map((c) => challengeLeaf(c)),
    outcomeLeaf(res),
  ];
  return merkleRoot(leaves);
}

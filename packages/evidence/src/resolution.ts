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
} from "./protocol";

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
}

export const DEFAULT_OPTIMISTIC_CONFIG: OptimisticConfig = {
  challengeWindowSec: 86_400, // 24h
  challengeBondMultiplier: 1.0, // challenger must match the stake
  attestorRewardFraction: 0.1, // 10% of stake minted as reward
  challengerRewardFraction: 0.1, // 10% of bond minted as reward
  maxAttestations: 10,
};

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
 *  starts the challenge window. */
export function submitAttestation(
  claim: ClaimResolutionState,
  attestation: Attestation,
  config: OptimisticConfig = DEFAULT_OPTIMISTIC_CONFIG,
  now: string = new Date().toISOString(),
): ClaimResolutionState {
  if (claim.state !== "OBSERVED" && claim.state !== "SUPPORTED") {
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
 *  Handles three cases:
 *  1. No challenge → OPTIMISTIC_FINALIZE: the first attestation wins.
 *  2. Challenge(s) exist → CONSENSUS_VOTE: weigh attestations by stake.
 *  3. Challenge window hasn't passed yet → throws (must wait).
 */
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
    // No challenge — optimistic finalize
    return optimisticFinalize(claim, now);
  }

  if (claim.state === "CHALLENGED") {
    // Resolve via consensus weighted by stake
    return consensusResolution(claim, config, now);
  }

  throw new Error(`Cannot finalize claim in state ${claim.state}`);
}

// ---------------------------------------------------------------------------
// Internal resolution methods
// ---------------------------------------------------------------------------

function optimisticFinalize(
  claim: ClaimResolutionState,
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
  };

  return {
    ...claim,
    state: "RESOLVED",
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

  const finalProbability = totalWeight > 0n
    ? Number(weightedSum) / Number(totalWeight) / 1_000_000
    : 0.5;

  // Determine the binary outcome: probability > 0.5 is TRUE
  const result = finalProbability > 0.5;

  // Mark attestations as correct or incorrect
  const updatedAttestations = claim.attestations.map((att) => {
    const matches = attestationMatchesResolution(att.decision, result);
    return {
      ...att,
      settledAt: now,
      slashed: matches === false,
      reward: matches === true
        ? (BigInt(att.stake) * BigInt(Math.round(config.attestorRewardFraction * 1_000)) / 1000n).toString()
        : "0",
    };
  });

  const updatedChallenges = claim.challenges.map((ch) => {
    if (ch.state === "OPEN") {
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
    method: "CONSENSUS_VOTE",
    tier: determineResolutionTier(claim, finalProbability, "CONSENSUS_VOTE"),
    basis: updatedAttestations.filter((a) => !a.slashed).map((a) => a.id),
    resolvedAt: now,
    effectiveVotes: Math.round(effectiveVotes * 1000) / 1000, // Σ independence
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

/** Check if a claim is in a terminal state. */
export function isTerminal(state: ClaimState): boolean {
  return state === "RESOLVED" || state === "FINAL";
}
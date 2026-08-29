/** Verifiable Knowledge Protocol — core objects and state machine (teacher's
 *  framework, V1: optimistic verification).
 *
 *  Design principle (from the protocol review): the system does NOT try to
 *  prove "AI said the truth". It proves that a sentence maps to a formal
 *  Claim; the Claim has replayable, locatable, tamper-evident Evidence; named
 *  Agents made economically-risked judgments about it; a Resolution was
 *  produced; and anyone can re-execute the whole verification.
 *
 *  Six core objects: Claim / Evidence / Attestation / Challenge / Resolution
 *  / Citation. evidence_support is kept separate from truth_resolution.
 */

// ---------------------------------------------------------------------------
// Claim lifecycle (teacher §30)
// ---------------------------------------------------------------------------

export type ClaimState =
  | "DRAFT" // extracted, not yet observed/anchored
  | "OBSERVED" // evidence anchored (hash on chain / storage)
  | "SUPPORTED" // at least one attestation, no active challenge
  | "CHALLENGED" // a challenge is pending resolution
  | "DISPUTED" // escalated beyond the optimistic layer
  | "RESOLVED" // resolution produced (final truth outcome known)
  | "FINAL"; // settlement applied (rewards/slashes executed)

export const CLAIM_STATE_ORDER: ClaimState[] = [
  "DRAFT",
  "OBSERVED",
  "SUPPORTED",
  "CHALLENGED",
  "DISPUTED",
  "RESOLVED",
  "FINAL",
];

/** Legal transitions for the claim state machine. */
export const CLAIM_STATE_TRANSITIONS: Record<ClaimState, ClaimState[]> = {
  DRAFT: ["OBSERVED"],
  OBSERVED: ["SUPPORTED"],
  SUPPORTED: ["CHALLENGED", "RESOLVED"], // challenge raises; or optimistic finalize
  CHALLENGED: ["DISPUTED", "RESOLVED"], // escalated, or dispute settled at this layer
  DISPUTED: ["RESOLVED"],
  RESOLVED: ["FINAL"],
  FINAL: [],
};

// ---------------------------------------------------------------------------
// Verification tiers (teacher §21 / §33 oracle ladder)
// ---------------------------------------------------------------------------

/** L0-L5 truth-resolution ladder. Higher tier = higher cost, higher finality. */
export type VerificationTier =
  | "L0_CRYPTOGRAPHIC" // deterministic: chain state, signatures, merkle proofs
  | "L1_OBSERVABLE" // externally observable facts (web, market data, docs)
  | "L2_AI_VALIDATORS" // independent AI/human validators
  | "L3_ECONOMIC_DISPUTE" // prediction market / arbitration
  | "L4_HUMAN_EXPERT" // human arbitration
  | "L5_INSTITUTIONAL"; // external institutional oracle

// ---------------------------------------------------------------------------
// Attestation — a validator's economically-risked judgment
// ---------------------------------------------------------------------------

export type AttestationDecision = "SUPPORTED" | "CONTRADICTED" | "UNCERTAIN";

export interface Attestation {
  id: string; // "ATT-000001"
  claimId: string;
  agent: string; // ERC-8004 agent id or wallet address (eip155:56:0x…)
  decision: AttestationDecision;
  /** Reported probability of the claim being true, 0..1. */
  confidence: number;
  /** VERI staked behind this judgment (locked until resolution). */
  stake: string; // wei (VERI has 18 decimals)
  rationale?: string;
  model?: string; // "some-model-v7"
  policy?: string; // "web-evidence-v1"
  createdAt: string; // ISO-8601
  /** Set when this attestation settles. */
  settledAt?: string;
  slashed?: boolean;
  reward?: string; // wei minted/returned on correct resolution
}

// ---------------------------------------------------------------------------
// Challenge — a dispute against the optimistic outcome
// ---------------------------------------------------------------------------

export type ChallengeState = "OPEN" | "ESCALATED" | "REJECTED" | "UPHELD";

export interface Challenge {
  id: string; // "CHL-000001"
  claimId: string;
  challenger: string; // agent/wallet address
  /** Bond staked by the challenger (refunded if the dispute is upheld). */
  bond: string; // wei VERI
  reason?: string;
  state: ChallengeState;
  createdAt: string;
  resolvedAt?: string;
  /** TRUE if the challenger was right (the original attestation was wrong). */
  challengerWon?: boolean;
}

// ---------------------------------------------------------------------------
// Resolution — the final truth outcome
// ---------------------------------------------------------------------------

export type ResolutionMethod =
  | "OPTIMISTIC_FINALIZE" // challenge window passed, no dispute
  | "CONSENSUS_VOTE" // weighted validator vote at dispute layer
  | "PREDICTION_MARKET" // V2+: market-aggregated probability
  | "HUMAN_ARBITRATION" // V2+: expert adjudication
  | "CRYPTOGRAPHIC"; // L0 deterministic verification

export interface ClaimResolution {
  id: string; // "RES-000001"
  claimId: string;
  /** Final truth: TRUE / FALSE / INDETERMINATE (not enough to resolve). */
  result: boolean | null;
  /** Final probability estimate 0..1 (post-dispute aggregate). */
  finalProbability: number;
  method: ResolutionMethod;
  tier: VerificationTier;
  /** Which attestation/evidence drove the outcome (for audit). */
  basis: string[];
  resolvedAt: string;
  /** On-chain anchor of the resolution (claimHash + result + root). */
  txHash?: string;
  blockNumber?: number;
  /** Merkle root over attestations + challenge + outcome (teacher §21). */
  resolutionRoot?: string;
}

// ---------------------------------------------------------------------------
// Citation — the verifiable reference envelope (teacher §19-§22)
// ---------------------------------------------------------------------------

export interface EvidenceLocator {
  type: "text-span" | "selector" | "quote";
  start?: number;
  end?: number;
  selector?: string;
}

export interface EvidenceRef {
  id: string; // "ev:71"
  cid?: string; // content-addressed URI (greenfield/ipfs)
  sha256: string;
  source: string; // original URL
  publishedAt?: string;
  retrievedAt: string;
  locator?: EvidenceLocator;
  quote?: string;
  quoteHash?: string; // sha256 of the quoted span
  snapshotHash?: string; // sha256 of the full page snapshot
}

export interface CitationEnvelope {
  claimId: string;
  claimText: string;
  evidence: EvidenceRef[];
  resolution: {
    state: ClaimState;
    result: boolean | null;
    finalProbability: number;
    resolutionId?: string;
  };
  /** Chain anchor of the claim's evidence hash. */
  anchor?: {
    evidenceHash: string;
    txHash?: string;
    network?: string;
  };
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

/** true if the transition from `from` to `to` is legal. */
export function canTransition(from: ClaimState, to: ClaimState): boolean {
  return CLAIM_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Outcome of an attestation vs a final resolution (teacher §4). */
export function attestationMatchesResolution(
  decision: AttestationDecision,
  result: boolean | null,
): boolean | null {
  if (result === null) return null; // indeterminate — no slash
  if (decision === "SUPPORTED") return result === true;
  if (decision === "CONTRADICTED") return result === false;
  return null; // UNCERTAIN is never slashed
}

/** Brier score for a reported probability (teacher §9, strictly proper). */
export function brierScore(reportedProbability: number, outcome: boolean): number {
  const o = outcome ? 1 : 0;
  const d = reportedProbability - o;
  return d * d;
}

/** Log score (proper scoring rule). outcome=true uses p, outcome=false uses 1-p. */
export function logScore(reportedProbability: number, outcome: boolean): number {
  const p = outcome ? reportedProbability : 1 - reportedProbability;
  const clamped = Math.min(0.999999, Math.max(0.000001, p));
  return -Math.log(clamped);
}

/** Events that drive the claim state machine. */
export type ClaimStateEvent =
  | { type: "OBSERVED" }
  | { type: "ATTESTED" }
  | { type: "CHALLENGED" }
  | { type: "DISPUTED" }
  | { type: "RESOLVED" }
  | { type: "FINALIZED" };

/** Recompute the claim state after an event (pure state machine step). */
export function nextClaimState(
  current: ClaimState,
  event: ClaimStateEvent,
): ClaimState {
  const target = (
    {
      OBSERVED: "OBSERVED",
      ATTESTED: "SUPPORTED",
      CHALLENGED: "CHALLENGED",
      DISPUTED: "DISPUTED",
      RESOLVED: "RESOLVED",
      FINALIZED: "FINAL",
    } satisfies Record<ClaimStateEvent["type"], ClaimState>
  )[event.type];
  if (!canTransition(current, target)) {
    throw new Error(
      `Illegal claim state transition: ${current} -> ${target} (event ${event.type})`,
    );
  }
  return target;
}

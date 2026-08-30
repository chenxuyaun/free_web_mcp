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
  /** Search provider used to gather evidence (teacher §13: same Search API
   *  → same information pipeline). */
  searchProvider?: string; // "duckduckgo" | "bing" | "exa" | …
  /** Source pages this validator actually read (teacher §13: same web page
   *  → same information pipeline). URL list, deduplicated. */
  sources?: string[];
  /** Validator's reputation snapshot at attestation time (teacher §9-§10):
   *  running average of (1 − Brier), 0..1 — 1.0 = perfectly calibrated.
   *  Captured BEFORE this bet settles, so it reflects the historical
   *  track record that this judgment is staked on. */
  reputation?: number;
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
  /** Bond economic outcome after settlement (V6): TRUE = bond forfeited
   *  (challenger was wrong), FALSE = returned. */
  bondSlashed?: boolean;
  /** Reward minted to the challenger on a successful challenge (V6),
   *  wei — challengerRewardFraction × bond. */
  bondReward?: string;
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
  /** Effective independent votes behind the resolution (teacher §13):
   *  sum of per-attestation independence, always ≤ basis count. */
  effectiveVotes?: number;
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
  };}

// ---------------------------------------------------------------------------
// Agent independence (teacher §12-§13)
// ---------------------------------------------------------------------------

/** Correlation between two attestations on a 0..1 scale.
 *  Heuristic dependency model (teacher §12-§13: same model / same Search API /
 *  same web page / same prompt → likely the same information source):
 *  - same agent            → 1.0 (identical)
 *  - same model            → 0.7 (strong shared pipeline)
 *  - same search provider  → 0.5 (shared retrieval channel)
 *  - overlapping sources   → 0.5 × Jaccard (shared pages read)
 *  - same policy           → 0.3 (weak signal)
 *  Capped at 1.0. */
export function attestationCorrelation(a: Attestation, b: Attestation): number {
  if (a.agent.toLowerCase() === b.agent.toLowerCase()) return 1.0;
  let c = 0;
  if (a.model && b.model && a.model === b.model) c += 0.7;
  if (a.searchProvider && b.searchProvider && a.searchProvider === b.searchProvider) c += 0.5;
  // Jaccard overlap over the set of source pages actually read
  if (a.sources && b.sources && a.sources.length > 0 && b.sources.length > 0) {
    const aSet = new Set(a.sources.map((s) => s.replace(/\/+$/, "")));
    const bSet = new Set(b.sources.map((s) => s.replace(/\/+$/, "")));
    let intersection = 0;
    for (const s of aSet) if (bSet.has(s)) intersection++;
    const union = new Set([...aSet, ...bSet]).size;
    if (union > 0) c += 0.5 * (intersection / union);
  }
  if (a.policy && b.policy && a.policy === b.policy) c += 0.3;
  return Math.min(1.0, c);
}

/** Independence score of each attestation: 1 - max correlation with any
 *  other attestation (teacher §12). 1.0 = fully independent, 0 = same
 *  information pipeline. A single attestation is fully independent. */
export function computeIndependence(attestations: Attestation[]): number[] {
  if (attestations.length <= 1) return attestations.map(() => 1.0);
  return attestations.map((a, i) => {
    let maxCorr = 0;
    for (let j = 0; j < attestations.length; j++) {
      if (j === i) continue;
      maxCorr = Math.max(maxCorr, attestationCorrelation(a, attestations[j]));
    }
    return 1 - maxCorr;
  });
}

/** Effective number of independent votes (teacher §13):
 *  effective_votes = Σ independence, so 100 same-model agents count far
 *  less than 5 diverse ones. */
export function effectiveVotes(attestations: Attestation[]): number {
  return computeIndependence(attestations).reduce((sum, v) => sum + v, 0);
}

/** Log-odds belief pool (L3 economic dispute / prediction market, teacher
 *  §25-§27: market-aggregated probability).
 *
 *  Each participant contributes a probability `p` with weight `w` (their
 *  economic influence). Instead of a plain weighted average — which treats a
 *  0.9 and a 0.1 as canceling to 0.5 — the pool aggregates in logit space,
 *  where probabilities are unbounded: strong, well-funded beliefs push the
 *  pooled price harder, exactly how a prediction market prices outcomes.
 *
 *  logit(p) = ln(p/(1−p)); pooled = σ(Σ w·logit(p) / Σ w).
 *  Extreme p are clamped so logit stays finite.
 */
export function logitPool(entries: Array<{ p: number; w: number }>): number {
  const EPS = 1e-9;
  let num = 0;
  let den = 0;
  for (const { p, w } of entries) {
    if (w <= 0) continue;
    const clamped = Math.min(1 - EPS, Math.max(EPS, p));
    const logit = Math.log(clamped / (1 - clamped));
    num += w * logit;
    den += w;
  }
  if (den === 0) return 0.5;
  const pooled = 1 / (1 + Math.exp(-num / den));
  return pooled;
}

/** Determine the oracle-ladder tier for a resolution (teacher §21 / §33).
 *  Higher tier = higher cost, higher finality.
 *
 *  Rules:
 *  - No challenge / optimistic finalize → L2 (AI validator consensus)
 *  - Challenge exists, consensus clear (|p−0.5| ≥ 0.1) → L2
 *  - Challenge exists, high disagreement (|p−0.5| < 0.1) → L3 economic dispute
 *  - Challenge exists, extreme disagreement (|p−0.5| < 0.05) → L4 human expert
 *  - L0/L1/L5 are reserved for cryptographic, observable, and institutional
 *    methods and are set manually. */
export function determineResolutionTier(
  claim: { challenges: Array<{ state: ChallengeState }> },
  finalProbability: number,
  method: ResolutionMethod,
): VerificationTier {
  if (method === "CRYPTOGRAPHIC") return "L0_CRYPTOGRAPHIC";
  // No challenge → no escalation needed
  if (claim.challenges.length === 0) return "L2_AI_VALIDATORS";
  // Dispute severity: how close to the knife-edge 0.5. A small epsilon
  // absorbs floating-point noise (0.5 − 0.4 can compute as 0.0999…98), so
  // exact boundaries (e.g. distance = 0.1) don't spuriously escalate.
  const EPS = 1e-9;
  const distance = Math.abs(finalProbability - 0.5) + EPS;
  if (distance < 0.05) return "L4_HUMAN_EXPERT";
  if (distance < 0.1) return "L3_ECONOMIC_DISPUTE";
  return "L2_AI_VALIDATORS";
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

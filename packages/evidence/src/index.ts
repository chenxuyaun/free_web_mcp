export { extractClaims, classifyClaim } from "./claims";
export { EvidenceEngine } from "./engine";
export { canonicalJson, evidenceHash, sha256 } from "./hash";
export { buildEvidencePackage } from "./package";
export type {
  Claim,
  ClaimType,
  CounterEvidence,
  EvidencePackage,
  EvidenceSource,
  SourceType,
  VerificationResult,
  VerificationStatus,
} from "./types";
export {
  brierScore,
  logScore,
  canTransition,
  nextClaimState,
  attestationMatchesResolution,
  CLAIM_STATE_ORDER,
  CLAIM_STATE_TRANSITIONS,
  type Attestation,
  type AttestationDecision,
  type Challenge,
  type ChallengeState,
  type CitationEnvelope,
  type ClaimResolution,
  type ClaimState,
  type EvidenceLocator,
  type EvidenceRef,
  type ResolutionMethod,
  type VerificationTier,
} from "./protocol";
export {
  submitAttestation,
  submitChallenge,
  finalizeResolution,
  isTerminal,
  DEFAULT_OPTIMISTIC_CONFIG,
  type ClaimResolutionState,
  type OptimisticConfig,
} from "./resolution";

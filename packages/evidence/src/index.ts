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

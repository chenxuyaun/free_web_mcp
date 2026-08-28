/** Shared evidence-domain types (spec §9-§15). */

export type ClaimType =
  | "fact"
  | "event"
  | "number"
  | "date"
  | "relationship"
  | "opinion"
  | "inference";

export interface Claim {
  id: string;
  text: string;
  type: ClaimType;
}

export type SourceType =
  | "official"
  | "primary"
  | "major_media"
  | "professional"
  | "secondary"
  | "unknown"
  | "social";

export interface EvidenceSource {
  url: string;
  title: string;
  sourceType: SourceType;
  publishedAt?: string; // ISO-8601
  retrievedAt: string; // ISO-8601
  contentHash: string; // SHA-256 of the raw content this source represents
}

export type VerificationStatus =
  | "SUPPORTED"
  | "LIKELY_TRUE"
  | "UNCERTAIN"
  | "CONTRADICTED"
  | "INSUFFICIENT_EVIDENCE";

export interface CounterEvidence {
  claim: string;
  searches: string[];
  sources: EvidenceSource[];
  found: boolean;
}

export interface VerificationResult {
  supportingSources: number;
  contradictingSources: number;
  independentSources: number;
  duplicateSources: number;
  sourceTraceable: boolean;
  crossVerified: boolean;
  status: VerificationStatus;
  confidence: number; // 0..1
}

export interface EvidencePackage {
  id: string; // "EV-000001"
  claim: Claim;
  sources: EvidenceSource[];
  verification: VerificationResult;
  counterEvidence: CounterEvidence;
  assessment: {
    status: VerificationStatus;
    confidence: number;
  };
  provenance: {
    engineVersion: string;
    createdAt: string; // ISO-8601
    hashAlgorithm: "SHA-256";
  };
  blockchain: {
    anchored: boolean;
    txHash?: string;
    contractAddress?: string;
    network?: string;
    blockNumber?: number;
    evidenceHash?: string;
    uri?: string;
  } | null;
  /** Decentralized storage pointer (Phase G, spec §27). */
  storage?: {
    uri: string;
    kind: string; // "greenfield"
  };
}

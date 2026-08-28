import { EvidenceEngine } from "./engine";
import { evidenceHash } from "./hash";
import { EvidencePackage, VerificationResult } from "./types";

export interface BuildPackageInput {
  id: string;
  claimText: string;
  claimType: EvidencePackage["claim"]["type"];
  supporting: EvidencePackage["sources"];
  contradicting?: EvidencePackage["sources"];
  counterEvidence?: EvidencePackage["counterEvidence"];
  crossVerified: boolean;
  engineVersion?: string;
  /** Injectable for deterministic hashing in tests / replay. */
  createdAt?: string;
}

/** Assemble a complete EvidencePackage (spec §14) + compute its hash. */
export function buildEvidencePackage(input: BuildPackageInput): {
  pkg: EvidencePackage;
  hash: string;
} {
  const engine = new EvidenceEngine({ engineVersion: input.engineVersion });
  const verification: VerificationResult = engine.verifyEvidence({
    supporting: input.supporting,
    contradicting: input.contradicting ?? [],
    crossVerified: input.crossVerified,
  });

  const pkg: EvidencePackage = {
    id: input.id,
    claim: {
      id: `claim_${input.id.replace("EV-", "").padStart(3, "0")}`,
      text: input.claimText,
      type: input.claimType,
    },
    sources: [...input.supporting, ...(input.contradicting ?? [])],
    verification,
    counterEvidence: input.counterEvidence ?? {
      claim: input.claimText,
      searches: [],
      sources: [],
      found: false,
    },
    assessment: engine.calculateAssessment(verification),
    provenance: {
      engineVersion: engine.engineVersion,
      createdAt: input.createdAt ?? new Date().toISOString(),
      hashAlgorithm: "SHA-256",
    },
    blockchain: null,
  };

  return { pkg, hash: evidenceHash(pkg) };
}

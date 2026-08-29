import { NextResponse } from "next/server";
import type { CitationEnvelope, EvidenceRef } from "@free-web-mcp/evidence";
import { getDb, getEvidencePackage } from "@/lib/db";
import { loadClaimState } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

/** GET /api/claims/[id]/citation — the verifiable reference envelope.
 *
 *  Teacher §19-§22: an AI response should not carry the whole evidence
 *  package, nor just a bare hash. It carries a Citation: Claim + short
 *  quote + locator + CID/hash + resolution state + on-chain anchor — and
 *  anyone (human or AI) can expand it end-to-end back to the original
 *  page, the snapshot, the validators and the resolution tx.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const pkg = getEvidencePackage(params.id);
  if (!pkg) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Claim ${params.id} not found.` } },
      { status: 404 },
    );
  }

  const state = loadClaimState(getDb(), params.id);

  const evidence: EvidenceRef[] = pkg.sources.map((s, i) => ({
    id: `ev:${i + 1}`,
    sha256: s.contentHash || "",
    source: s.url,
    publishedAt: s.publishedAt,
    retrievedAt: s.retrievedAt,
    cid: pkg.storage?.uri,
    // The claim text's first sentence serves as the short quote — the full
    // snapshot (and span locators) come from the content-addressed package.
    locator: { type: "quote" },
    quote: pkg.claim.text.slice(0, 160),
  }));

  const envelope: CitationEnvelope = {
    claimId: pkg.id,
    claimText: pkg.claim.text,
    evidence,
    resolution: {
      state: state?.state ?? "OBSERVED",
      result: state?.resolution?.result ?? null,
      finalProbability: state?.resolution?.finalProbability ?? pkg.assessment.confidence,
      resolutionId: state?.resolution?.id,
    },
    ...(pkg.blockchain?.evidenceHash
      ? {
          anchor: {
            evidenceHash: pkg.blockchain.evidenceHash,
            txHash: pkg.blockchain.txHash,
            network: pkg.blockchain.network,
          },
        }
      : {}),
  };

  return NextResponse.json({ success: true, citation: envelope });
}

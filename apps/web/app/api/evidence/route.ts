import { NextResponse } from "next/server";
import {
  buildEvidencePackage,
  canonicalJson,
  type ClaimType,
  type EvidenceSource,
} from "@free-web-mcp/evidence";
import { getStats, insertEvidence, listEvidence, markPublished } from "@/lib/db";
import { getGreenfieldPublisher } from "@/lib/greenfield";

export const dynamic = "force-dynamic";

interface CreateBody {
  claim: { text: string; type?: string };
  supporting?: Array<Partial<EvidenceSource>>;
  contradicting?: Array<Partial<EvidenceSource>>;
  counterSearches?: string[];
  crossVerified?: boolean;
}

/** Fill in defaults for partial sources coming from the MCP layer. */
function normalizeSource(s: Partial<EvidenceSource>, index: number): EvidenceSource {
  return {
    url: s.url ?? "",
    title: s.title ?? `source-${index + 1}`,
    sourceType: s.sourceType ?? "unknown",
    publishedAt: s.publishedAt,
    retrievedAt: s.retrievedAt ?? new Date().toISOString(),
    contentHash: s.contentHash ?? "",
    quote: s.quote,
  };
}

const VALID_CLAIM_TYPES: ClaimType[] = [
  "fact",
  "event",
  "number",
  "date",
  "relationship",
  "opinion",
  "inference",
];

/** GET /api/evidence?status=&q= — list + statistics (spec §20). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const items = listEvidence({
    status: searchParams.get("status") || undefined,
    q: searchParams.get("q") || undefined,
    limit: 100,
  });
  const stats = getStats();
  return NextResponse.json({ success: true, stats, items });
}

/** POST /api/evidence — build a package via the evidence engine and persist it. */
export async function POST(request: Request) {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  const claimText = body.claim?.text?.trim();
  if (!claimText) {
    return NextResponse.json(
      { success: false, error: { type: "PARSER_ERROR", message: "claim.text is required." } },
      { status: 400 },
    );
  }

  const supporting = (body.supporting ?? []).map(normalizeSource);
  const contradicting = (body.contradicting ?? []).map(normalizeSource);
  if (supporting.length === 0 && contradicting.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "SEARCH_FAILED",
          message: "At least one supporting or contradicting source is required.",
        },
      },
      { status: 400 },
    );
  }

  const rawType = body.claim.type;
  const claimType: ClaimType =
    rawType && VALID_CLAIM_TYPES.includes(rawType as ClaimType)
      ? (rawType as ClaimType)
      : "fact";

  const { pkg, hash } = buildEvidencePackage({
    id: "EV-TEMP", // db assigns the real sequential id on insert
    claimText,
    claimType,
    supporting,
    contradicting,
    counterEvidence: {
      claim: claimText,
      searches: body.counterSearches ?? [],
      sources: [],
      found: contradicting.length > 0,
    },
    crossVerified: body.crossVerified ?? false,
  });

  const saved = insertEvidence({ pkg, hash, payloadJson: canonicalJson(pkg) });

  // Project 2: auto-publish to BNB Greenfield so the evidence is
  // content-addressed in decentralized storage and the citation envelope
  // immediately carries a CID. Fire-and-forget — the record is already
  // valid without storage, and a failure must never block creation
  // (the publish route remains for manual retry).
  void autoPublish(saved.id, canonicalJson(pkg));

  return NextResponse.json({ success: true, id: saved.id, hash, package: saved });
}

/** Best-effort publish of an evidence package to Greenfield. */
async function autoPublish(id: string, payloadJson: string): Promise<void> {
  try {
    const publisher = getGreenfieldPublisher();
    const result = await publisher.publish(payloadJson);
    markPublished(id, result.uri);
    console.log(`[evidence] auto-published ${id} → ${result.uri}`);
  } catch (e) {
    // Soft failure — the record stays valid; publish/route.ts can retry.
    console.warn(
      `[evidence] auto-publish skipped for ${id}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

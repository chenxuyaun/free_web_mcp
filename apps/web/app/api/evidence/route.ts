import { NextResponse } from "next/server";
import {
  buildEvidencePackage,
  type ClaimType,
  type EvidenceSource,
} from "@free-web-mcp/evidence";
import { getStats, insertEvidence, listEvidence } from "@/lib/db";

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

  const saved = insertEvidence({ pkg, hash });
  return NextResponse.json({ success: true, id: saved.id, hash, package: saved });
}

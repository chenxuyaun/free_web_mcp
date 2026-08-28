import { NextResponse } from "next/server";
import { canonicalJson } from "@free-web-mcp/evidence";
import { getGreenfieldPublisher } from "@/lib/greenfield";
import { getEvidencePackage, markPublished } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Publish an evidence package to BNB Greenfield (spec §27, Phase G).
 *
 * Content-addressed by the canonical SHA-256: the on-chain anchor's
 * `evidenceHash` matches the object name, so the URI is self-verifying.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(request, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many publish calls." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const pkg = getEvidencePackage(params.id);
  if (!pkg) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Evidence ${params.id} not found.` } },
      { status: 404 },
    );
  }

  let publisher;
  try {
    publisher = getGreenfieldPublisher();
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Greenfield not configured.",
        },
      },
      { status: 500 },
    );
  }

  try {
    // The published payload must be byte-identical to what was hashed:
    // canonicalJson is the same canonicalization the evidence hash used.
    const json = canonicalJson(pkg);
    const result = await publisher.publish(json);

    markPublished(params.id, result.uri);

    return NextResponse.json({
      success: true,
      uri: result.uri,
      contentHash: result.contentHash,
      size: result.size,
      txHash: result.txHash,
      retrievable: await publisher.isRetrievable(result.uri),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Greenfield publish failed.",
        },
      },
      { status: 500 },
    );
  }
}

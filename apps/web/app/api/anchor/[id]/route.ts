import { NextResponse } from "next/server";
import { getRegistryClient } from "@/lib/blockchain";
import { getEvidenceHash, getEvidencePackage, markAnchored } from "@/lib/db";

export const dynamic = "force-dynamic";

interface AnchorBody {
  /** Explicit user confirmation (spec §13: chain writes need explicit confirm). */
  confirm?: boolean;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: AnchorBody;
  try {
    body = (await request.json()) as AnchorBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: "Anchoring writes to the blockchain — pass {confirm: true} to proceed.",
        },
      },
      { status: 400 },
    );
  }

  const pkg = getEvidencePackage(params.id);
  if (!pkg) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Evidence ${params.id} not found.` } },
      { status: 404 },
    );
  }
  const evidenceHash = getEvidenceHash(params.id);
  if (!evidenceHash) {
    return NextResponse.json(
      { success: false, error: { type: "PARSER_ERROR", message: "Evidence hash missing." } },
      { status: 500 },
    );
  }

  let client;
  try {
    client = getRegistryClient();
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Blockchain not configured.",
        },
      },
      { status: 500 },
    );
  }

  const version = pkg.provenance.engineVersion;
  const uri = `free-web-mcp://evidence/${params.id}`;

  try {
    const result = await client.anchorEvidence(`0x${evidenceHash}`, uri, version);
    const blockchain = {
      anchored: true,
      evidenceHash: `0x${evidenceHash}`,
      contractAddress: result.contractAddress,
      network: result.network,
      blockNumber: Number(result.blockNumber),
      txHash: result.txHash,
      uri,
    };
    markAnchored(params.id, blockchain);
    return NextResponse.json({ success: true, blockchain });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Anchor transaction failed.",
        },
      },
      { status: 500 },
    );
  }
}

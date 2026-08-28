import { NextResponse } from "next/server";
import { EvidenceRegistryClient } from "@free-web-mcp/blockchain";
import { getRegistryConfig } from "@/lib/blockchain";
import { getEvidencePackage, listEvidence } from "@/lib/db";

export const dynamic = "force-dynamic";

/** On-chain anchor feed (M1C).
 *
 * Public BSC RPCs cap getLogs ranges, so instead of event scanning we index
 * anchored records in SQLite (blockNumber/txHash/evidenceHash captured at
 * anchor time) and verify each against the chain with a point read
 * (exists/getEvidence) — no range limits, every entry chain-verified.
 */
export async function GET() {
  try {
    const client = new EvidenceRegistryClient(getRegistryConfig());
    const anchored = listEvidence().filter(
      (e) => e.anchored && getEvidencePackage(e.id)?.blockchain?.network === client.chain.name,
    ).slice(0, 5);

    const records = [];
    for (const e of anchored) {
      const pkg = getEvidencePackage(e.id);
      const bc = pkg?.blockchain;
      const onChain = bc?.evidenceHash
        ? await client.exists(`0x${bc.evidenceHash.replace(/^0x/, "")}` as `0x${string}`)
        : false;
      records.push({
        evidenceId: e.id,
        evidenceHash: bc?.evidenceHash ?? e.hash,
        txHash: bc?.txHash ?? null,
        blockNumber: bc?.blockNumber ?? null,
        network: bc?.network ?? null,
        submitter: null,
        verifiedOnChain: onChain,
        txUrl: bc?.txHash && client.explorerUrl ? `${client.explorerUrl}/tx/${bc.txHash}` : null,
      });
    }

    return NextResponse.json({
      success: true,
      network: client.chain.name,
      explorerUrl: client.explorerUrl ?? null,
      records,
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: { type: "RENDER_FAILED", message: e instanceof Error ? e.message : String(e) },
      },
      { status: 200 },
    );
  }
}

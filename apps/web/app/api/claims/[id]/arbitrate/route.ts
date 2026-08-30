import { NextResponse } from "next/server";
import { getRegistryClient } from "@/lib/blockchain";
import { getDb, markAnchored } from "@/lib/db";
import { arbitrateClaim, computeResolutionRoot } from "@/lib/protocol-db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface ArbitrateBody {
  /** The expert's final ruling on the claim's truth. */
  result: boolean;
  /** Human expert identifier (wallet address / eip155:… id). */
  expert: string;
  /** Why the expert ruled this way. */
  rationale?: string;
  /** Chain write needs explicit confirm (spec §13 pattern). */
  confirm?: boolean;
}

/** POST /api/claims/[id]/arbitrate — L4 human-expert arbitration (V19).
 *  Only DISPUTED claims are arbitrable: the expert's ruling produces a
 *  HUMAN_ARBITRATION resolution that settles attestations and challenges. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(request, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: ArbitrateBody;
  try {
    body = (await request.json()) as ArbitrateBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  if (typeof body.result !== "boolean") {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "result must be true or false." } },
      { status: 400 },
    );
  }
  const expert = (body.expert ?? "").trim().toLowerCase();
  if (!expert.startsWith("0x") && !expert.startsWith("eip155:")) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "expert must be a wallet address or eip155:… id." } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const state = arbitrateClaim(db, params.id, {
      result: body.result,
      expert,
      rationale: body.rationale,
    });
    const res = state.resolution;
    if (!res) {
      return NextResponse.json(
        { success: false, error: { type: "RENDER_FAILED", message: "No resolution produced." } },
        { status: 409 },
      );
    }

    let txHash: string | null = null;
    let blockNumber: number | null = null;
    let resolutionRoot: string | null = null;

    if (body.confirm === true) {
      resolutionRoot = computeResolutionRoot(state);
      const client = getRegistryClient();
      const anchor = await client.resolveClaim(
        `0x${state.evidenceHash}` as `0x${string}`,
        res.result === true,
        res.method,
        `0x${resolutionRoot}` as `0x${string}`,
      );
      txHash = anchor.txHash;
      blockNumber = Number(anchor.blockNumber);
      markAnchored(params.id, {
        anchored: true,
        evidenceHash: `0x${state.evidenceHash}`,
        contractAddress: anchor.contractAddress,
        network: anchor.network,
        blockNumber: Number(anchor.blockNumber),
        txHash: anchor.txHash,
        uri: `free-web-mcp://evidence/${params.id}/arbitration`,
      });
    }

    return NextResponse.json({
      success: true,
      state: {
        id: state.id,
        state: state.state,
        resolution: res,
        anchored: txHash !== null,
        txHash,
        blockNumber,
        resolutionRoot,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: { type: "RENDER_FAILED", message: e instanceof Error ? e.message : String(e) } },
      { status: 409 },
    );
  }
}

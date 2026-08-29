import { NextResponse } from "next/server";
import { canonicalJson, sha256 } from "@free-web-mcp/evidence";
import { getRegistryClient } from "@/lib/blockchain";
import { getDb } from "@/lib/db";
import { finalizeClaim, loadClaimState } from "@/lib/protocol-db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface FinalizeBody {
  /** Chain write needs explicit confirm (spec §13 pattern). */
  confirm?: boolean;
}

/** POST /api/claims/[id]/finalize — close the challenge window, produce a
 *  resolution, and (with confirm:true) anchor it on-chain via
 *  resolveClaim(claimHash, result, method, resolutionRoot). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(request, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: FinalizeBody = {};
  try {
    body = (await request.json()) as FinalizeBody;
  } catch {
    // body optional
  }

  try {
    const db = getDb();
    const state = finalizeClaim(db, params.id);
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
      // Compute the resolution root: sha256 over attestations + challenges +
      // outcome (teacher §21: merkle-style root so settlement is recomputable).
      const rootInput = {
        attestations: state.attestations.map((a) => ({
          agent: a.agent,
          decision: a.decision,
          confidence: a.confidence,
          stake: a.stake,
          slashed: a.slashed ?? false,
        })),
        challenges: state.challenges.map((c) => ({
          challenger: c.challenger,
          bond: c.bond,
          state: c.state,
          challengerWon: c.challengerWon ?? null,
        })),
        result: res.result,
        finalProbability: res.finalProbability,
        method: res.method,
      } as unknown as Parameters<typeof canonicalJson>[0];
      resolutionRoot = sha256(canonicalJson(rootInput));

      const client = getRegistryClient();
      const anchor = await client.resolveClaim(
        `0x${state.evidenceHash}` as `0x${string}`,
        res.result === true,
        res.method,
        `0x${resolutionRoot}` as `0x${string}`,
      );
      txHash = anchor.txHash;
      blockNumber = Number(anchor.blockNumber);
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

/** GET /api/claims/[id]/finalize — current resolution status (for polling). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const state = loadClaimState(getDb(), params.id);
  if (!state) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Claim ${params.id} not found.` } },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, state });
}

import { NextResponse } from "next/server";
import { getRegistryClient } from "@/lib/blockchain";
import { getDb, markAnchored } from "@/lib/db";
import { computeResolutionRoot, finalizeClaim, loadClaimState, type ScoringRule } from "@/lib/protocol-db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface FinalizeBody {
  /** Chain write needs explicit confirm (spec §13 pattern). */
  confirm?: boolean;
  /** Proper scoring rule for reputation settlement (teacher §9-§10).
   *  "brier" (default) or "log". */
  scoringRule?: ScoringRule;
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
    const rule: ScoringRule = body.scoringRule === "log" ? "log" : "brier";
    const state = finalizeClaim(db, params.id, undefined, rule);
    const res = state.resolution;

    // V14: a knife-edge dispute stays DISPUTED (no resolution) so more
    // independent validators can weigh in — this is a valid outcome, not
    // an error. No anchoring (nothing final to anchor).
    if (!res) {
      return NextResponse.json({
        success: true,
        state: {
          id: state.id,
          state: state.state, // "DISPUTED"
          resolution: null,
          anchored: false,
          escalated: true,
          escalation: state.challenges.some((c) => c.state === "ESCALATED")
            ? "PREDICTION_MARKET"
            : null,
        },
      });
    }

    let txHash: string | null = null;
    let blockNumber: number | null = null;
    let resolutionRoot: string | null = null;

    // V13: an INDETERMINATE (escalated) resolution has no boolean outcome —
    // anchoring `result === null` as FALSE on-chain would manufacture
    // certainty. Skip the write and surface the escalation instead.
    const indeterminate = res.result === null;

    if (body.confirm === true && !indeterminate) {
      // Compute the resolution root: sha256 over attestations + challenges +
      // outcome (teacher §21: merkle-style root so settlement is recomputable).
      // Shared with the verify route so the local root always matches what
      // gets anchored.
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

      // Persist the resolution anchor so the on-chain feed (chain/records)
      // picks it up — same shape as the anchor route writes.
      markAnchored(params.id, {
        anchored: true,
        evidenceHash: `0x${state.evidenceHash}`,
        contractAddress: anchor.contractAddress,
        network: anchor.network,
        blockNumber: Number(anchor.blockNumber),
        txHash: anchor.txHash,
        uri: `free-web-mcp://evidence/${params.id}/resolution`,
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
        escalated: indeterminate,
        escalation: indeterminate ? res.method : null,
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

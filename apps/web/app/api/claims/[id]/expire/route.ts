import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { expireClaim, loadClaimState } from "@/lib/protocol-db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/claims/[id]/expire — V25: mark a claim EXPIRED when its
 *  challenge window closed without a resolution. Terminal state: no stake
 *  settlement, nothing anchored — the dispute simply lapsed. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(request, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  try {
    const db = getDb();
    const state = expireClaim(db, params.id);
    return NextResponse.json({
      success: true,
      state: {
        id: state.id,
        state: state.state, // "EXPIRED"
        updatedAt: state.updatedAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: { type: "RENDER_FAILED", message: e instanceof Error ? e.message : String(e) } },
      { status: 409 },
    );
  }
}

/** GET /api/claims/[id]/expire — current state (for polling). */
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

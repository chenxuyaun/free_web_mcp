import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { finalizeClaim } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

/** POST /api/claims/[id]/finalize — close the challenge window and produce a resolution. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const state = finalizeClaim(db, params.id);
    return NextResponse.json({
      success: true,
      state: {
        id: state.id,
        state: state.state,
        resolution: state.resolution,
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
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadClaimState } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

/** GET /api/claims/[id] — full claim state (attestations + challenges + resolution). */
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

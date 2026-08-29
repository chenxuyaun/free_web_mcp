import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { challengeClaim } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

interface ChallengeBody {
  challenger: string;
  bond: string;
  reason?: string;
}

/** POST /api/claims/[id]/challenge — dispute an attestation with a bond. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: ChallengeBody;
  try {
    body = (await request.json()) as ChallengeBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  const challenger = (body.challenger ?? "").trim().toLowerCase();
  if (!challenger.startsWith("0x") && !challenger.startsWith("eip155:")) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "challenger must be a wallet address or eip155:… id." } },
      { status: 400 },
    );
  }
  const bond = (body.bond ?? "").trim();
  if (!/^\d+$/.test(bond)) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "bond must be a wei integer string." } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const state = challengeClaim(db, params.id, {
      challenger,
      bond,
      reason: body.reason,
    });
    return NextResponse.json({
      success: true,
      state: {
        id: state.id,
        state: state.state,
        challenges: state.challenges.length,
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
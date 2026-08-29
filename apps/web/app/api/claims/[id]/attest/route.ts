import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { attestClaim, loadClaimState } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

interface AttestBody {
  agent: string;
  decision: "SUPPORTED" | "CONTRADICTED" | "UNCERTAIN";
  confidence: number;
  stake: string; // wei VERI
  rationale?: string;
  model?: string;
}

/** POST /api/claims/[id]/attest — validator submits a staked judgment. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: AttestBody;
  try {
    body = (await request.json()) as AttestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  const agent = (body.agent ?? "").trim().toLowerCase();
  if (!agent.startsWith("0x") && !agent.startsWith("eip155:")) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "agent must be a wallet address or eip155:… id." } },
      { status: 400 },
    );
  }
  if (!["SUPPORTED", "CONTRADICTED", "UNCERTAIN"].includes(body.decision)) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "decision must be SUPPORTED/CONTRADICTED/UNCERTAIN." } },
      { status: 400 },
    );
  }
  const confidence = Number(body.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "confidence must be in [0,1]." } },
      { status: 400 },
    );
  }
  const stake = (body.stake ?? "").trim();
  if (!/^\d+$/.test(stake)) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "stake must be a wei integer string." } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const state = attestClaim(db, params.id, {
      agent,
      decision: body.decision,
      confidence,
      stake,
      rationale: body.rationale,
      model: body.model,
    });
    return NextResponse.json({
      success: true,
      state: {
        id: state.id,
        state: state.state,
        attestations: state.attestations.length,
        challengeDeadline: state.challengeDeadline,
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

/** GET /api/claims/[id] — full claim state. */
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

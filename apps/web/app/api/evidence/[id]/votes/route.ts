import { NextResponse } from "next/server";
import { listVotesForEvidence } from "@/lib/db";

export const dynamic = "force-dynamic";

/** All votes for one evidence record (validator feed + timeline). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const votes = listVotesForEvidence(params.id);
  return NextResponse.json({ success: true, votes });
}

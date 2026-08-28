import { NextResponse } from "next/server";
import { listValidators, listVotes } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Validator leaderboard + recent vote feed (spec §25). */
export async function GET() {
  const validators = listValidators();
  const recentVotes = listVotes();
  return NextResponse.json({ success: true, validators, recentVotes });
}

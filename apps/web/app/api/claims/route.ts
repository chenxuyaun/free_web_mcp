import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listClaims } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

/** GET /api/claims — list claims with their protocol state. */
export async function GET() {
  const db = getDb();
  const items = listClaims(db);
  return NextResponse.json({ success: true, items });
}

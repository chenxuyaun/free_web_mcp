import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getSystemStatus();
  return NextResponse.json(status);
}

import { NextResponse } from "next/server";
import { getEvidencePackage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const pkg = getEvidencePackage(params.id);
  if (!pkg) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Evidence ${params.id} not found.` } },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, package: pkg });
}

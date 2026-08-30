import { NextResponse } from "next/server";
import { getRegistryClient } from "@/lib/blockchain";
import { getDb } from "@/lib/db";
import { computeResolutionRoot, loadClaimState } from "@/lib/protocol-db";

export const dynamic = "force-dynamic";

/** GET /api/claims/[id]/verify — recompute the resolution root locally and
 *  verify it against the on-chain resolution record (V7).
 *
 *  This closes the "verifiable" loop (teacher §19-§22): anyone can take a
 *  claim's local state (attestations, challenges, outcome), recompute the
 *  SHA-256 resolution root, and check it matches what EvidenceRegistry
 *  stored on-chain. A match proves the final outcome was honestly anchored.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const state = loadClaimState(getDb(), params.id);
  if (!state) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Claim ${params.id} not found.` } },
      { status: 404 },
    );
  }

  const res = state.resolution;
  if (!res) {
    return NextResponse.json(
      { success: false, error: { type: "RENDER_FAILED", message: `Claim ${params.id} is not resolved yet.` } },
      { status: 409 },
    );
  }

  try {
    // Recompute the same root the finalize route anchored (shared helper —
    // both routes must use computeResolutionRoot so the local root always
    // matches what was written on-chain).
    const localRoot = computeResolutionRoot(state);

    const hash = `0x${state.evidenceHash}` as `0x${string}`;
    const client = getRegistryClient();
    const [resolved, onChain] = await Promise.all([
      client.isResolved(hash),
      client.getResolution(hash),
    ]);

    const onChainRoot = onChain.exists ? onChain.resolutionRoot.toLowerCase() : null;
    const rootMatch =
      onChainRoot !== null && onChainRoot === `0x${localRoot}`.toLowerCase();

    return NextResponse.json({
      success: true,
      verification: {
        claimId: state.id,
        evidenceHash: `0x${state.evidenceHash}`,
        resolvedOnChain: resolved,
        onChainRoot,
        localRoot: `0x${localRoot}`,
        rootMatch,
        verified: resolved && rootMatch,
        onChain: onChain.exists
          ? {
              result: onChain.result,
              method: onChain.method,
              timestamp: Number(onChain.timestamp),
              resolver: onChain.resolver,
            }
          : null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: { type: "RENDER_FAILED", message: e instanceof Error ? e.message : String(e) } },
      { status: 500 },
    );
  }
}

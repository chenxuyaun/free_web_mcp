import { NextResponse } from "next/server";
import {
  ERC8004_REPUTATION_ADDRESS_TESTNET,
  ReputationClient,
} from "@free-web-mcp/blockchain";
import type { Hex } from "viem";
import { getRegisteredAgent } from "@/lib/agent";
import { getRegistryConfig } from "@/lib/blockchain";
import { getEvidenceHash, getEvidencePackage, getGreenfieldUri } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface FeedbackBody {
  confirm?: boolean;
  /** Evidence whose verification anchors this feedback. */
  evidenceId?: string;
  /** 0-100 client satisfaction with the agent's verification (default 90). */
  value?: number;
}

function getReputationClient(): ReputationClient {
  const reg = getRegistryConfig();
  return new ReputationClient({
    rpcUrl: reg.rpcUrl,
    chain: reg.chain,
    reputationAddress:
      (process.env.ERC8004_REPUTATION_ADDRESS as Hex | undefined) ??
      ERC8004_REPUTATION_ADDRESS_TESTNET,
    feedbackPrivateKey:
      (process.env.FEEDBACK_PRIVATE_KEY as Hex | undefined) ?? undefined,
  });
}

/** Current reputation summary (read-only). */
export async function GET() {
  const reg = getRegisteredAgent();
  if (!reg) {
    return NextResponse.json({ success: true, registered: false });
  }
  try {
    const rep = getReputationClient();
    const client = (process.env.FEEDBACK_ADDRESS as Hex | undefined) ?? undefined;
    const summary = await rep.getSummary(BigInt(reg.agentId), client ? [client] : []);
    return NextResponse.json({
      success: true,
      registered: true,
      agentId: reg.agentId,
      summary: {
        count: summary.count.toString(),
        overallValue: summary.overallValue.toString(),
        valueDecimals: summary.valueDecimals,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : String(e),
        },
      },
      { status: 200 },
    );
  }
}

/** Post client feedback for the agent (Phase A reputation loop). */
export async function POST(request: Request) {
  const rl = rateLimit(request, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many feedback calls." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: "Feedback writes on-chain reputation — pass {confirm: true}.",
        },
      },
      { status: 400 },
    );
  }

  const reg = getRegisteredAgent();
  if (!reg) {
    return NextResponse.json(
      {
        success: false,
        error: { type: "INVALID_URL", message: "Agent not registered yet." },
      },
      { status: 400 },
    );
  }

  const evidenceId = body.evidenceId;
  if (!evidenceId) {
    return NextResponse.json(
      {
        success: false,
        error: { type: "INVALID_URL", message: "evidenceId is required." },
      },
      { status: 400 },
    );
  }

  const pkg = getEvidencePackage(evidenceId);
  if (!pkg) {
    return NextResponse.json(
      {
        success: false,
        error: { type: "INVALID_URL", message: `Evidence ${evidenceId} not found.` },
      },
      { status: 404 },
    );
  }

  const feedbackURI = getGreenfieldUri(evidenceId) ?? pkg.storage?.uri ?? `free-web-mcp://evidence/${evidenceId}`;
  const evidenceHash = getEvidenceHash(evidenceId) ?? "";
  const value = Math.max(0, Math.min(100, Math.round(body.value ?? 90)));

  try {
    const rep = getReputationClient();
    const txHash = await rep.giveFeedback({
      agentId: BigInt(reg.agentId),
      value,
      tag1: "evidence-verification",
      tag2: pkg.claim.type,
      endpoint: process.env.MCP_SERVER_URL ?? "",
      feedbackURI,
      feedbackHash: `0x${evidenceHash.replace(/^0x/, "")}` as `0x${string}`,
    });
    const explorer = getRegistryConfig().explorerUrl;
    return NextResponse.json({
      success: true,
      agentId: reg.agentId,
      value,
      feedbackURI,
      txHash,
      txUrl: explorer ? `${explorer}/tx/${txHash}` : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Feedback write failed.",
        },
      },
      { status: 500 },
    );
  }
}

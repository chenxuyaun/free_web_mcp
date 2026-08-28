import { NextResponse } from "next/server";
import { getAgentClient, getRegisteredAgent, saveRegisteredAgent } from "@/lib/agent";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface RegisterBody {
  /** Explicit user confirmation (spec §13: chain writes need explicit confirm). */
  confirm?: boolean;
  /** Where agent.json lives. Defaults to the GitHub repo README. */
  agentURI?: string;
}

const DEFAULT_AGENT_URI = "https://github.com/chenxuyaun/free_web_mcp";

/** Current registration status (read-only). */
export async function GET() {
  const reg = getRegisteredAgent();
  return NextResponse.json({ success: true, registration: reg });
}

/** Register the Free Web MCP agent on the ERC-8004 Identity Registry (Phase A). */
export async function POST(request: Request) {
  const rl = rateLimit(request, { limit: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many register calls." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
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
          message: "Registering mints an on-chain agent identity — pass {confirm: true}.",
        },
      },
      { status: 400 },
    );
  }

  const existing = getRegisteredAgent();
  if (existing) {
    return NextResponse.json({ success: true, registration: existing, alreadyRegistered: true });
  }

  const agentURI = (body.agentURI ?? DEFAULT_AGENT_URI).trim();

  try {
    const client = getAgentClient();
    const result = await client.register(agentURI);
    const reg: Parameters<typeof saveRegisteredAgent>[0] = {
      agentId: result.agentId.toString(),
      txHash: result.txHash,
      agentURI: result.agentURI,
      identityAddress: client.identityAddress,
    };
    saveRegisteredAgent(reg);
    return NextResponse.json({
      success: true,
      registration: reg,
      txUrl: client.txUrl(result.txHash),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: {
          type: "RENDER_FAILED",
          message: e instanceof Error ? e.message : "Agent registration failed.",
        },
      },
      { status: 500 },
    );
  }
}

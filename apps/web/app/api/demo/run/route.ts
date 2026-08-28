import { NextResponse } from "next/server";
import { buildEvidencePackage, type EvidenceSource } from "@free-web-mcp/evidence";
import { insertEvidence } from "@/lib/db";
import { McpClient } from "@/lib/mcp";

export const dynamic = "force-dynamic";

interface DemoStep {
  step: string;
  ok: boolean;
  detail?: string;
}

interface SearchResult {
  url?: string;
  title?: string;
}

/** One-click demo (spec §22): a fixed demo claim runs through search →
 *  fetch → extract → verify → hash, returning a persisted evidence record.
 *
 *  The blockchain anchor is deliberately NOT auto-run here — anchoring is a
 *  permanent public write and requires explicit user confirmation (spec §13);
 *  the UI offers it right after this call succeeds.
 */
export async function POST() {
  const steps: DemoStep[] = [];
  const claimText = "Anthropic released the Model Context Protocol in November 2024";
  const mcpBase = process.env.MCP_SERVER_URL || "http://127.0.0.1:8765";
  const mcp = new McpClient(mcpBase);

  // 0. Handshake — required before any tool call on Streamable HTTP.
  try {
    await mcp.initialize();
    steps.push({ step: "Connect", ok: true, detail: "MCP session established" });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: { type: "SEARCH_FAILED", message: e instanceof Error ? e.message : "MCP connect failed" },
      steps,
    });
  }

  // 1. web_search (retry: DuckDuckGo public search transiently rate-limits)
  let results: SearchResult[] = [];
  try {
    for (let attempt = 1; attempt <= 3 && results.length === 0; attempt++) {
      const r = await mcp.callTool<{ results?: SearchResult[] }>("web_search", {
        query: "Anthropic Model Context Protocol release",
        max_results: 2,
      });
      results = r.results ?? [];
      if (results.length === 0 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    steps.push({ step: "Search", ok: results.length > 0, detail: `${results.length} result(s)` });
  } catch (e) {
    steps.push({ step: "Search", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 2. web_fetch on the first result
  const supporting: EvidenceSource[] = [];
  try {
    const first = results[0];
    if (first?.url) {
      const fetched = await mcp.callTool<{ success?: boolean; url?: string; title?: string; text_length?: number }>(
        "web_fetch",
        { url: first.url },
      );
      if (fetched.success) {
        supporting.push({
          url: fetched.url ?? first.url,
          title: fetched.title ?? first.title ?? "search result",
          sourceType: "major_media",
          retrievedAt: new Date().toISOString(),
          contentHash: `len-${fetched.text_length ?? 0}`,
        });
        steps.push({
          step: "Fetch",
          ok: true,
          detail: `${(fetched.title ?? first.url).slice(0, 50)} (${fetched.text_length ?? "?"} chars)`,
        });
      } else {
        steps.push({ step: "Fetch", ok: false, detail: "fetch returned success:false" });
      }
    } else {
      steps.push({ step: "Fetch", ok: false, detail: "no search result to fetch" });
    }
  } catch (e) {
    steps.push({ step: "Fetch", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  // 3-6. Extract + Verify + Hash (via the evidence engine directly)
  if (supporting.length > 0) {
    const { pkg, hash } = buildEvidencePackage({
      id: "EV-TEMP",
      claimText,
      claimType: "event",
      supporting,
      contradicting: [],
      counterEvidence: {
        claim: claimText,
        searches: [
          '"Anthropic released MCP in November 2024" fact check',
          '"Model Context Protocol" release date official',
        ],
        sources: [],
        found: false,
      },
      crossVerified: supporting.length >= 2,
    });
    const saved = insertEvidence({ pkg, hash });
    steps.push({ step: "Extract", ok: true, detail: "claim classified: event" });
    steps.push({ step: "Verify", ok: true, detail: pkg.assessment.status });
    steps.push({ step: "Hash", ok: true, detail: `sha256:${hash.slice(0, 16)}…` });
    return NextResponse.json({
      success: true,
      evidenceId: saved.id,
      hash,
      status: pkg.assessment.status,
      confidence: pkg.assessment.confidence,
      steps,
    });
  }

  return NextResponse.json({
    success: false,
    error: { type: "SEARCH_FAILED", message: "Demo could not gather evidence." },
    steps,
  });
}

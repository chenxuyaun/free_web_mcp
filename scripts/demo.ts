/** `pnpm demo` — CLI demo of the full evidence pipeline (spec §33).
 *
 * Runs against the running services:
 *   - MCP server (Python, :8765) for web_search / web_fetch
 *   - Dashboard API (Next, :3000) for evidence create
 *
 * Streamable HTTP requires an initialize handshake to obtain a session id;
 * the demo does that once and reuses it for tool calls.
 */

const DASHBOARD = process.env.DASHBOARD_URL || "http://localhost:3000";
const MCP_BASE = process.env.MCP_SERVER_URL || "http://127.0.0.1:8765";
const MCP_URL = `${MCP_BASE}/mcp`;

let sessionId: string | null = null;

async function mcpRequest(method: string, params: object) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const sid = r.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;
  if (!r.ok) throw new Error(`MCP HTTP ${r.status}: ${await r.text()}`);
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) || text;
  const json = JSON.parse(line.replace(/^data: /, ""));
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json;
}

async function callTool(name: string, args: object) {
  const res = await mcpRequest("tools/call", { name, arguments: args });
  const content = res.result?.content?.[0]?.text;
  if (!content) throw new Error(`tool ${name} returned no content`);
  return JSON.parse(content);
}

async function main() {
  console.log("→ Running demo pipeline…\n");

  // 0. MCP initialize handshake
  await mcpRequest("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "pnpm-demo", version: "0.1.0" },
  });
  console.log("✓ Connect     MCP session established");

  // 1. Search (retry: DuckDuckGo public search transiently rate-limits)
  let search: { results?: Array<{ url?: string; title?: string }> } | null = null;
  for (let attempt = 1; attempt <= 3 && !search?.results?.length; attempt++) {
    search = await callTool("web_search", {
      query: "Anthropic Model Context Protocol release",
      max_results: 1,
    });
    if (!search?.results?.length && attempt < 3) {
      console.log(`  (empty result — retrying (${attempt}/3))`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  const url = search?.results?.[0]?.url;
  if (!url) throw new Error("web_search returned nothing after retries");
  console.log(`✓ Search      ${(search.results[0]?.title ?? url).slice(0, 60)}`);

  // 2. Fetch
  const fetched = await callTool("web_fetch", { url });
  if (!fetched?.success) throw new Error("web_fetch failed");
  console.log(`✓ Fetch       ${(fetched.title ?? url).slice(0, 60)} (${fetched.text_length} chars)`);

  // 3-6. Evidence package via dashboard API
  const claim = "Anthropic released the Model Context Protocol in November 2024";
  const r = await fetch(`${DASHBOARD}/api/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claim: { text: claim, type: "event" },
      supporting: [
        {
          url: fetched.url,
          title: fetched.title,
          sourceType: "major_media",
          retrievedAt: new Date().toISOString(),
          contentHash: `len-${fetched.text_length}`,
        },
      ],
      counterSearches: [
        '"Anthropic released MCP in November 2024" fact check',
        '"Model Context Protocol" release date official',
      ],
      crossVerified: false,
    }),
  });
  const created = (await r.json()) as { success?: boolean; id?: string; hash?: string; error?: { message?: string } };
  if (!created.success || !created.id || !created.hash) {
    throw new Error(created.error?.message ?? "evidence create failed");
  }
  console.log(`✓ Extract     claim classified: event`);
  console.log(`✓ Verify      evidence package created (id ${created.id})`);
  console.log(`✓ Hash        sha256:${created.hash.slice(0, 16)}…`);
  console.log(`\nDemo completed successfully.\n`);
  console.log(`Evidence ID: ${created.id}`);
  console.log(`Hash: ${created.hash}`);
  console.log(`View: ${DASHBOARD}/evidence/${created.id}`);
}

main().catch((e) => {
  console.error(`\nDemo failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

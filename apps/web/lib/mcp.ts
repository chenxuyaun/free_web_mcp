/** Streamable-HTTP MCP client helper for server-side Next.js code.
 *
 * The MCP server requires an initialize handshake that returns a
 * `Mcp-Session-Id`; subsequent tool calls must carry it. This module
 * manages one session per request (route handlers are short-lived).
 */

export class McpClient {
  private base: string;
  private sessionId: string | null = null;

  constructor(mcpBase: string) {
    this.base = mcpBase.replace(/\/+$/, "") + "/mcp";
  }

  private async send(method: string, params: object): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const r = await fetch(this.base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1e6),
        method,
        params,
      }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const sid = r.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;
    if (!r.ok) throw new Error(`MCP HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const text = await r.text();
    const line = text.split("\n").find((l) => l.startsWith("data: ")) || text;
    const json = JSON.parse(line.replace(/^data: /, "")) as {
      error?: { message?: string };
      result?: { content?: Array<{ text?: string }> };
    };
    if (json.error) throw new Error(json.error.message ?? "MCP error");
    return json.result;
  }

  async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "free-web-mcp-dashboard", version: "0.1.0" },
    });
  }

  /** Call a tool; returns the parsed JSON from the first text content block. */
  async callTool<T>(name: string, args: object): Promise<T> {
    const result = await this.send("tools/call", { name, arguments: args });
    const content = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    if (!content) throw new Error(`tool ${name} returned no text content`);
    return JSON.parse(content) as T;
  }
}

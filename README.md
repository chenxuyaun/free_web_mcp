# free-web-mcp

> A free, open-source MCP server that gives any AI agent (Claude, Cursor, ChatGPT Connectors, …) web search + web fetch + content extraction + a one-call "search-and-fetch" combo + a link-source classifier — all through the standard [Model Context Protocol](https://modelcontextprotocol.io/) over Streamable HTTP.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue.svg)](pyproject.toml)
[![MCP 2025-06-18](https://img.shields.io/badge/MCP-2025--06--18-purple.svg)](https://modelcontextprotocol.io/)
[![CI](https://github.com/chenxuyaun/free_web_mcp/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)

**Live demo (ngrok fallback)**: <https://mononuclear-polytonally-clifton.ngrok-free.dev>
**For a permanent URL**, follow [Render deployment](docs/deploy_live_url.md#path-a-render-permanent).

---

## How judges can connect

This is a **standard MCP server** (Streamable HTTP transport). It is **not** auto-discovered by Chrome's WebMCP origin trial — that spec only sees tools registered via `document.modelContext.registerTool()` on the currently loaded page, and explicit remote-MCP discovery is out of scope in the 2025-06-18 spec. **To use it, paste the URL into a real MCP client** — three options below.

### ChatGPT (web / Atlas in-app browser)

Settings → Connectors → Add → URL: `https://<your-live-url>/mcp`

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "free-web-mcp": {
      "url": "https://<your-live-url>/mcp"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "free-web-mcp": {
      "url": "https://<your-live-url>/mcp"
    }
  }
}
```

### Quick sanity check

```bash
curl https://<your-live-url>/health
# {"status":"ok","service":"free-web-mcp","version":"0.1.0"}

# MCP initialize
curl -X POST https://<your-live-url>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"judge","version":"0"}}}'
```

---

## Tools

| Tool | Description | Inputs |
| --- | --- | --- |
| `web_search` | Search the web (DuckDuckGo, no API key). Each result carries `source_domain` and a `confidence` score (0-1). | `query: str`, `max_results: int = 5` (1-10) |
| `web_fetch` | Fetch a URL and extract its main readable content. Returns a `meta` block with `domain_type`, `https`, `published_at`, `fetched_at`, `author`, `content_length_raw`. | `url: str`, `rendered: bool = False` |
| `web_search_and_fetch` | Search the web, then fetch + extract Top-N URLs in one call. | `query: str`, `max_results: int = 5` (1-10), `rendered: bool = False` |
| `web_summarize_with_sources` | Extract authors / citations / links from a page and classify each link as **primary** (same domain) / **secondary** (gov / edu / academic) / **tertiary** (aggregator / social). | `url: str \| None`, `html: str \| None`, `max_links: int = 25` |

All four tools return `{success: true, ...}` on success and `{success: false, error: {type, message}}` on failure. The `type` field is one of: `INVALID_URL`, `FETCH_FAILED`, `TIMEOUT`, `HTTP_ERROR`, `PARSER_ERROR`, `SEARCH_FAILED`, `RATE_LIMITED`, `CONTENT_TOO_LARGE`, `RENDER_FAILED`, `RENDER_TIMEOUT`, `INTERNAL_ERROR`.

For JSON schemas of each tool's inputs, see [docs/tools.md](docs/tools.md) or `GET /.well-known/mcp.json` on a running instance.

---

## Quick start

```bash
git clone https://github.com/chenxuyaun/free_web_mcp.git
cd free_web_mcp
uv sync
uv run free-web-mcp                                # stdio mode — for Cursor/Claude Desktop
# or
uv run free-web-mcp --transport http --port 8000   # http mode — for ChatGPT / web clients
```

That's it. No API keys. DuckDuckGo works out of the box. Optional `.env` settings (see [`.env.example`](.env.example)):

| Var | Default | What it does |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Python logging level |
| `HTTP_TIMEOUT` | `30` | Fetch timeout (s) |
| `MAX_CONTENT_LENGTH` | `5000000` | Max response body (bytes) |
| `SEARCH_MAX_RESULTS` | `10` | Hard cap on `max_results` |
| `RENDER_ENABLED` | `false` | Enable Playwright JS-rendered fetch (needs Chromium; ~150MB image if you also `playwright install chromium`) |

---

## Architecture

```
MCP Client (Claude / Cursor / ChatGPT / Inspector)
        |  Streamable HTTP
        v
+--------------------------------------+
|  free-web-mcp                        |
|  +-------------------------+         |
|  | MCP Tool Layer          |  <- only this layer is exposed to MCP
|  |  web_search             |  |     (4 tools, all return typed JSON)
|  |  web_fetch              |  |
|  |  web_search_and_fetch   |  |
|  |  web_summarize_with_sources |
|  +-----------+-------------+         |
|              v                       |
|  +-------------------------+         |
|  | Service Layer           |  |  SearchService / FetchService
|  +-----------+-------------+  |  (orchestrate providers + parser)
|              v                       |
|  +-------------------------+         |
|  | Provider Layer          |  |  DuckDuckGo (default, no API key)
|  |                         |  |  WebClient (unified HTTP)
|  |                         |  |  trafilatura + BeautifulSoup
|  |                         |  |  Playwright (optional, JS render)
|  +-------------------------+         |
+--------------------------------------+
```

Strict layering: MCP tools **never** issue HTTP or parse HTML directly — every request goes through `WebClient`, every search through a `SearchProvider`, every parse through `parser.extract_*`. Swap in a new search engine by adding a provider; MCP tools do not change.

See [docs/free_web_mcp.md](docs/free_web_mcp.md) for the full design doc.

---

## Tested with

- **Cursor** (MCP via stdio and via the public HTTP URL) — all 4 tools exercised end-to-end against real DuckDuckGo + Wikipedia.
- **Claude Desktop** — same `claude_desktop_config.json` block above, MCP 2025-06-18 transport.
- **Built-in Python MCP test harness** (`mcp.shared.memory.create_connected_server_and_client_session`) — `tests/test_mcp.py` covers tool registration, return shapes, error wrapping, and the rendered / disabled paths without network.
- **`scripts/e2e_stdio_check.py`** — stdio e2e, spawns the server, calls every tool, asserts on real DuckDuckGo and Wikipedia responses.
- **`scripts/e2e_http_check.py`** — Streamable HTTP e2e against the live ngrok URL.

> **Not yet exercised in this submission**: ChatGPT Connectors UI (the protocol is the same MCP 2025-06-18 it expects; add the URL via Settings → Connectors and the assistant can call the tools); Chrome with WebMCP enabled (the server can be wired into a WebMCP page via `examples/webmcp_demo.html`).

---

## Built with

- **Primary AI tool**: [ZCode](https://zcode.io) (agent runtime on the `MiniMax-M3` model). ZCode wrote 9 of 10 commits in this repo — scaffolding, models, web layer, MCP layer, all 39 tests, deployment configs, the v1->v2->v3 feature split, and the `Host` header / 421 debugging that turned the ngrok URL green.
- **No other AI tools were used** in this project (no Cursor Composer, no Copilot Chat, no Claude.ai, no ChatGPT web).
- **Doc research** was done inside the same ZCode session using WebFetch against MCP, WebMCP, Cloudflare, and Render docs.
- **Design decisions** (which tools to ship, error code taxonomy, v1->v3 scope, the MCP-not-WebMCP framing) were made by the human author and reviewed against every ZCode-produced diff before commit.
- See [docs/AI_TOOLS_USED.md](docs/AI_TOOLS_USED.md) for the full breakdown.

---

## Deployment

- **Render (permanent)**: `render.yaml` is included — one-click Blueprint import. See [docs/deploy_live_url.md](docs/deploy_live_url.md).
- **ngrok (instant)**: `ngrok http 8000` while `free-web-mcp --transport http` is running. Used for the current live URL above.
- **Docker**: `docker build -f docker/Dockerfile -t free-web-mcp .` then `docker run --rm -p 8000:8000 free-web-mcp`. To enable `rendered=true` paths, build with `--build-arg INSTALL_PLAYWRIGHT_BROWSERS=true`.

---

## Development

```bash
uv sync
uv run pytest                # 39 tests, no real network needed
uv run ruff check .          # lint
uv run mypy                  # type check (strict)
```

CI runs the same three commands on every push — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## License

MIT — see [LICENSE](LICENSE).

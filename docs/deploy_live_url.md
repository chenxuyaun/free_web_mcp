# Deploy Free Web MCP to a Public URL

**Live deployment (self-hosted, yuncai.site):**

| Endpoint | Purpose |
| --- | --- |
| `https://yuncai.site/webmcp` | Evidence Network dashboard (Next.js, basePath `/webmcp`) |
| `https://yuncai.site/webmcp/api/health` | Dashboard liveness + live system status |
| `https://yuncai.site/mcp` | Streamable-HTTP MCP transport (8 tools) |
| `https://yuncai.site/.well-known/mcp.json` | MCP discovery document |

Server: Tencent Cloud (124.221.130.64), Docker Compose (`~/free-web-mcp/`),
nginx reverse proxy on yuncai.site (see `deploy/server/nginx-webmcp-locations.conf`).
Redeploy flow: build `deploy/web.Dockerfile` locally → `docker save | gzip` →
`scp` → `docker load` → `docker compose --env-file .env up -d --force-recreate web`.

This guide also covers two alternative paths: a **permanent public URL via Render** (free tier)
and an **instant temporary URL via ngrok** (for immediate demos).

Both expose the same MCP server in HTTP transport mode:

| Endpoint | Purpose |
| --- | --- |
| `GET  /health` | Liveness probe (`{"status":"ok"}`) |
| `POST /mcp`    | Streamable-HTTP MCP transport |

After deployment, judges can connect from:

- **ChatGPT** — Settings → Connectors → Add MCP server → URL
- **Claude Desktop** — `claude_desktop_config.json`:
  ```json
  { "mcpServers": { "free-web-mcp": {
      "url": "https://<your-url>/mcp"
  } } }
  ```
- **Cursor** — `.cursor/mcp.json` with `{"url": "https://<your-url>/mcp"}`
- **Chrome with WebMCP** — requires `chrome://flags/#enable-webmcp-testing` in Chrome 149+; once enabled, visiting a page that calls `document.modelContext.registerTool()` exposes the tools to the in-page AI. Note: Chrome's WebMCP is still Origin Trial as of 2026; ChatGPT's in-app browser does **not** auto-discover arbitrary MCP servers — users must connect via Settings.

---

## Path A: Render (permanent) — two services (M1C)

`render.yaml` defines a **Blueprint with both services**:

| Service | What | Health |
| --- | --- | --- |
| `free-web-mcp-web` | Next.js dashboard + evidence API (Node) | `GET /api/health` |
| `free-web-mcp-mcp` | Python MCP server, 8 tools (Streamable HTTP on :10000) | `GET /health` |

### Deploy steps

1. Push this repo to GitHub (already done for `chenxuyaun/free_web_mcp`).
2. Sign in to <https://render.com> with GitHub.
3. **New → Blueprint** → pick this repo → Render reads `render.yaml` and shows both services.
4. Fill the `sync: false` secrets when prompted:
   - `EVIDENCE_REGISTRY_ADDRESS` = `0xD4F14929A1694932439DDa1D481aA127f80185D7`
   - `VERI_TOKEN_ADDRESS` = `0x4FF843Db5196B3Ca7438ABe6E3d6FC16d94350Da`
   - `WALLET_PRIVATE_KEY` = your **testnet-only** private key (MetaMask export)
5. Click **Apply**. First build takes 3-5 minutes per service.
6. After deploy, edit the web service env `MCP_SERVER_URL` to the actual MCP URL
   (`https://free-web-mcp-mcp.onrender.com` if names unchanged) and **Manual Deploy** once.
7. Verify:
   - `curl https://free-web-mcp-web.onrender.com/api/health`
   - `curl https://free-web-mcp-mcp.onrender.com/health`
   - Dashboard → Blockchain CONNECTED (BSC Testnet), Run Demo, Anchor, Validator votes all work remotely.

### Caveats on Render free tier
- Services **spin down after 15 min of inactivity**; next request cold-starts (~30-50 s).
- SQLite lives on an ephemeral disk on free plans — evidence records reset on redeploys. Use the
  **Run Demo** button to regenerate demo data after any deploy.
- No Playwright/Chromium on Render — `RENDER_ENABLED=false` (v2 rendered fetch is local-only).

### Caveats on Render free tier
- Service **spins down after 15 min of inactivity**; the next request takes ~30 s to cold start.
- No Playwright/Chromium available — `RENDER_ENABLED=false` (the default). v1+v3 tools all work, v2 rendered fetch is disabled.
- 100 GB-month bandwidth is plenty for a demo.

---

## Path B: ngrok (instant, 5-minute demo URL)

Useful for showing judges a live URL **today** without committing to Render setup.

### One-time setup
1. Sign up at <https://ngrok.com> (free).
2. Grab your authtoken from <https://dashboard.ngrok.com/get-started/your-authtoken>.
3. Install: `winget install ngrok` (or download the Windows zip).
4. `ngrok config add-authtoken <your-token>`

### Run
```bash
# In a terminal, start the server on a local port
cd /path/to/free_web_mcp
uv run --no-sync free-web-mcp --transport http --host 127.0.0.1 --port 8000

# In another terminal, expose it
ngrok http 8000
```

ngrok prints a line like:

```
Forwarding   https://a1b2-c3d4.ngrok-free.app  ->  http://127.0.0.1:8000
```

The `https://a1b2-c3d4.ngrok-free.app` URL is your **Live URL** — share it with judges. It stays alive only while the local server and ngrok are running.

### Caveats
- URL is public for the duration of the ngrok session; anyone with the link can hit it.
- Free tier URL changes every time you restart ngrok.
- ngrok injects a warning interstitial on first visit (`Visit Site` button) — judges can click through.

---

## Verifying the Live URL works

After you have a URL, the most robust sanity check is the same MCP handshake judges will use:

```bash
URL=https://<your-live-url>
curl -s "$URL/health"
# {"status":"ok","service":"free-web-mcp"}

curl -s -X POST "$URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"sanity","version":"0"}}}' \
  | head -20
# Expect: serverInfo.name = "free-web-mcp" + mcp-session-id header
```

Or run the repo's end-to-end check, pointed at your URL:

```python
# scripts/e2e_http_check.py
import asyncio, json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = "https://<your-live-url>/mcp"

async def main():
    async with streamablehttp_client(URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print("TOOLS:", [t.name for t in tools.tools])
            result = await session.call_tool("web_search", {"query": "model context protocol", "max_results": 3})
            print(json.loads(result.content[0].text)["results"][0]["title"])

asyncio.run(main())
```

---

## What "Live URL judges can access" means in practice

Most hackathon-style requirements that mention "WebMCP" or "ChatGPT in-app browser" are satisfied by **any reachable HTTPS URL that exposes the MCP server over Streamable HTTP**. The judge then:

1. Opens ChatGPT → Settings → Connectors → Add the URL.
2. Asks the assistant a question that exercises one of the 4 tools.
3. Sees results.

A static page that auto-`fetch()`es `/mcp` and renders the output is also fine and is what `examples/webmcp_demo.html` (if you add one) would do. The two paths above are sufficient for the requirement as written.

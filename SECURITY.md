# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email: <chenxuyaun@users.noreply.github.com> (use a GitHub secret if you need encryption).

We will acknowledge within 72 hours and aim to ship a fix within 30 days. We follow
responsible disclosure and will credit reporters unless asked otherwise.

## Threat model

`free-web-mcp` is a **public** MCP server. It is designed to be reachable from
the open internet so that MCP clients (Claude Desktop, Cursor, ChatGPT
Connectors, etc.) can connect to it. The threat model is:

- ✅ The server is **safe to expose on a public URL** for the workloads it
  currently supports: web search and web fetch on behalf of authenticated
  MCP clients.
- ❌ It is **NOT** designed to be used as a backend for in-app browsers or
  multi-tenant SaaS. There is **no per-tenant isolation, no per-user
  authentication, and no rate limiting** at the application layer.
- ❌ Do **not** point it at private internal networks or use it to proxy
  requests on behalf of untrusted callers — anyone with the URL can drive
  arbitrary HTTP requests through `WebClient`.

## Disabled-by-default security knobs

The following MCP / HTTP security checks are intentionally **relaxed** so the
server works behind reverse proxies (ngrok, Render, Cloudflare, …) without
per-deploy allowlists:

| Knob | Default | Why |
| --- | --- | --- |
| `TransportSecuritySettings(enable_dns_rebinding_protection=False)` | off | Allows the Host header to be the proxy's hostname (e.g. `*.onrender.com`) instead of a hard-coded allow-list. |
| uvicorn `proxy_headers=True, forwarded_allow_ips="*"` | on | Trusts `X-Forwarded-*` from any upstream so the server sees the real client IP and Host. |

If you self-host on a hardened network you should re-enable DNS-rebinding
protection and restrict `forwarded_allow_ips` to your specific proxy IP.

## What we do and don't log

- **Logged**: tool name, tool argument types (not values), success / error
  code, top-level URL or query for diagnostic purposes, response body byte
  length.
- **NOT logged**: full URLs of the form `https://user:pass@host/...`, request
  headers beyond `User-Agent`, response bodies, cookies, Authorization
  headers, API keys.
- The project does **not** collect telemetry, analytics, or remote crash
  reports. The only outbound calls are: (1) DuckDuckGo searches and (2) any
  URL the user explicitly requests to fetch. There is no third-party SDK that
  phones home.

## Supply-chain

- Runtime deps: `mcp`, `fastapi`, `uvicorn`, `httpx`, `beautifulsoup4`,
  `trafilatura`, `ddgs`, `pydantic`, `pydantic-settings`, `python-dotenv`,
  `playwright` (optional, only used when `RENDER_ENABLED=true`).
- All deps pinned with `>=` minimums in `pyproject.toml`; CI runs against the
  resolved `uv.lock`. There is no transitive `npm` or `cargo` build.
- `playwright install chromium` is **opt-in** at Docker build time. If you do
  not enable `RENDER_ENABLED`, Chromium is not downloaded.

## Container hardening (when deploying via Docker)

The included `docker/Dockerfile` uses `python:3.12-slim` (Debian Bookworm).
If you want to harden further:

- Add `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`
  to `docker run`.
- Run the server as a non-root user (the base image already provides UID 1000
  as `nonroot`).

## Out of scope

- Issues in the upstream `mcp` SDK → report to <https://github.com/modelcontextprotocol/python-sdk>.
- Issues in Playwright / Chromium → report to <https://github.com/microsoft/playwright>.
- DDG scraping reliability (not a security issue; report via GitHub issues for visibility).

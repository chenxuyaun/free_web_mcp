# AI tools used in this project

This document answers the (common) hackathon question: **"Which AI tools have
you leveraged while working on this project?"** It is intentionally specific —
the goal is to make the human / AI boundary auditable.

## Primary AI tool

**[ZCode](https://zcode.io)** — the agent runtime this conversation is
happening inside. ZCode is the model `MiniMax-M3` accessed through the
ZCode CLI; the user sees only ZCode, the model is an implementation detail.

ZCode was used for:

| Area | What ZCode did |
| --- | --- |
| Scaffolding | `pyproject.toml`, `.env.example`, `src/free_web_mcp/{__init__,__main__,config,logging,errors,deps,server}.py`, the `src/free_web_mcp/{mcp,web,models}` package layout, `docker/Dockerfile`, `render.yaml`, `Procfile`, `.python-version`. |
| Web layer | `web/client.py` (httpx wrapper), `web/parser.py` (trafilatura + BeautifulSoup metadata extraction in v3), `web/search.py` (SearchService), `web/fetch.py` (FetchService with v2 Playwright routing), `web/render.py` (Playwright RenderClient with lazy import), `web/providers/{base,duckduckgo}.py`. |
| MCP layer | `mcp/server.py` (FastMCP factory with DNS-rebinding disabled for reverse-proxy use), `mcp/tools.py` (4 tools, error wrapping, v3 source-classification helper, tool annotations). |
| Data models | `models/search.py`, `models/page.py` (FetchedPage, PageMeta, SearchAndFetchResponse, SourceLink, SourceSummary) — Pydantic schemas. |
| Tests | 39 unit + integration tests across `tests/test_{parser,fetch,search,render,mcp,v3}.py` and `tests/conftest.py`. |
| e2e / scripts | `scripts/e2e_stdio_check.py`, `scripts/e2e_http_check.py` (the latter is used to verify the live ngrok URL). |
| Deployment | `render.yaml` Blueprint, `Procfile` and `Procfile.gunicorn`, `docker/Dockerfile` (Chromium download via `INSTALL_PLAYWRIGHT_BROWSERS=true`), `.python-version`, `docs/deploy_live_url.md` (Render + ngrok + ChatGPT Connect + Claude + Cursor snippets). |
| Live debugging | Traced and fixed the `HTTP/1.1 421 Misdirected Request` "Invalid Host header" returned by FastMCP's `enable_dns_rebinding_protection=True` default — root cause was the default, fix is in commit `fe80da6`. |
| Documentation | `README.md` (English, with badges, "How judges can connect" snippets, "Tested with" section, "Built with" section), `docs/free_web_mcp.md` (the original requirements doc), `docs/demo_video_script.md`, `docs/AI_TOOLS_USED.md` (this file), `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`. |
| Git operations | 10 commits authored through ZCode's `Bash` tool (one per logical unit). |

## Other AI tools

**None.** Specifically, the following were *not* used in this project:

- Cursor's Composer / Tab
- GitHub Copilot Chat
- Claude.ai web interface
- ChatGPT web interface
- Any other hosted AI coding assistant

Doc research that informed decisions (e.g. WebMCP Origin Trial status, MCP
2025-06-18 spec, Cloudflare Python Workers beta, Render Blueprint format) was
done by ZCode using its own `WebFetch` and `WebSearch` tools, with quotes
kept short and implementations written from the spec.

## Human-AI boundary

**The human author made all design decisions** before asking ZCode to
implement them. Concrete examples of decisions reserved for the human:

- Which four tools to ship in MVP (web_search, web_fetch, web_search_and_fetch,
  web_summarize_with_sources).
- The error-code taxonomy (`INVALID_URL`, `FETCH_FAILED`, `TIMEOUT`,
  `HTTP_ERROR`, `PARSER_ERROR`, `SEARCH_FAILED`, `RATE_LIMITED`,
  `CONTENT_TOO_LARGE`, `RENDER_FAILED`, `RENDER_TIMEOUT`, `INTERNAL_ERROR`).
- The v1 -> v2 (Playwright rendering) -> v3 (provenance metadata) feature
  split.
- The MCP-not-WebMCP framing for hackathon submission — based on research
  that confirmed WebMCP's spec does not include remote-server discovery.
- The deployment target choice (Render + ngrok fallback, not Cloudflare
  Workers) — based on research that Cloudflare Python Workers are still
  beta and cannot run Playwright.
- All commit message wording.
- The decision to disable DNS-rebinding host validation in favor of
  reverse-proxy compatibility (and to document it explicitly in
  `SECURITY.md`).

**ZCode proposed, the human reviewed and approved** every diff before it
landed in git. Some ZCode drafts were rejected and rewritten:

- The first version of `_compute_confidence` used a "weighted + boost + decay"
  formula. The human author requested the simpler, more transparent
  `base + rank_score` formula that's now in `web/search.py`.
- The first version of the v3 metadata block proposed 11 fields. The human
  author pruned it to 6 fields (the ones actually used by `web_summarize_with_sources`).
- The README went through three drafts — the first two were judged too
  "marketing-y" and the final English-first version is the result.

## Reproducing the work

```bash
git clone https://github.com/chenxuyaun/free_web_mcp.git
cd free_web_mcp
git log --oneline                 # 10 commits, all by chenxuyaun via ZCode
uv sync && uv run pytest          # 39 passed
```

The git history itself is the audit trail.

# Changelog

All notable changes to `free-web-mcp` are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-28

### Added
- v3 metadata: `web_fetch` returns a `meta` block with `domain_type`, `https`,
  `published_at`, `fetched_at`, `author`, `content_length_raw`.
- `web_search` results now include `source_domain` (lowercased, `www.`-stripped)
  and a `confidence` score (0-1) that combines ranking position with
  authority-TLD / domain-hint boosts.
- New tool `web_summarize_with_sources` — extracts authors, citations, and
  links; classifies each link as `primary` / `secondary` / `tertiary` so the
  agent can weight citations without reading every link.
- `/.well-known/mcp.json` discoverability document.
- `/health` now reports the application `version`.
- Rich tool metadata: per-tool `title`, `description`, and
  `annotations` (`readOnlyHint`, `openWorldHint`, `destructiveHint`).
- Rich parameter metadata: `description`, `ge` / `le` constraints surfaced in
  the JSON Schema clients see in `tools/list`.
- `instructions` field populated in the MCP `initialize` response so agents
  get a one-paragraph guide to the server's tools.
- Disables DNS-rebinding host validation so the server works behind ngrok,
  Render, Cloudflare, and other reverse proxies.
- Trust proxy headers via uvicorn (`proxy_headers=True, forwarded_allow_ips="*"`).
- `examples/` directory: `claude_desktop_config.json`, `cursor_mcp.json`,
  `chatgpt_connector.md`, `sample_prompts.md`, `webmcp_demo.html`.
- `SECURITY.md` describing the threat model and the disabled-by-default
  security knobs.
- `CONTRIBUTING.md` with dev setup, test policy, and Conventional Commits.

## [0.1.0] - 2026-08-27

### Added
- v1 MVP: `web_search` (DuckDuckGo, no API key), `web_fetch`, and
  `web_search_and_fetch`. Stdio + Streamable HTTP transports. `/health`
  endpoint. `Dockerfile`. `render.yaml` and `Procfile` for one-click
  deployment.
- v2 (released same day): `rendered` parameter on `web_fetch` /
  `web_search_and_fetch` drives a Playwright Chromium for JS-heavy pages.
  Opt-in via `RENDER_ENABLED=true` and `playwright install chromium`.
- v3 (released same day): see 0.2.0 above.
- Project scaffolding: `pyproject.toml` (uv + hatchling), strict mypy on
  `src/`, ruff lint with E/F/I/UP/B/SIM rules, pytest + pytest-asyncio +
  respx, GitHub Actions CI.
- 39 unit + integration tests covering all three layers (provider, service,
  MCP) and the error mapping for every `ErrorCode`.

[0.2.0]: https://github.com/chenxuyaun/free_web_mcp/compare/ba8dc24..0.2.0
[0.1.0]: https://github.com/chenxuyaun/free_web_mcp/releases/tag/0.1.0

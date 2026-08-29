# Changelog

All notable changes to `free-web-mcp` are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.2] - 2026-08-29

### Changed — MCP server on Python SDK 2.x

- Migrated apps/mcp-server from `mcp>=1.10,<2` to `mcp>=2.0,<3` (2.1.1):
  `FastMCP` → `MCPServer` (mcp.server.mcpserver), `version=` kwarg so
  serverInfo reports the app version (verified 0.4.0 on the wire),
  transport_security moved to streamable_http_app(), well-known doc uses
  public async list_tools() with spec-camelCase annotations.
- stateless_http stays off (legacy session protocol preserved for existing
  clients); flip to True when the x402 payment gateway lands.
- 50/50 pytest green, mypy/ruff clean; deployed to yuncai.site — /health,
  /mcp initialize handshake, all 8 tools and dashboard probe verified live.

### Changed — VERI v2: bitcoin-style zero-premine emission

- `VERI.sol` no longer takes an `initialSupply`: **totalSupply starts at 0**
  and grows only through reward minting (validator votes / challenges) —
  same emission philosophy as Bitcoin block rewards. No coins exist until
  someone earns them.
- Redeployed to BSC Testnet at `0xDDcbC86dE41bB8863a4Acd929E965d0E07A54C76`
  (verified on-chain: supply 0 → reward mint → 100). The old 100M-premine
  token (`0x4FF843Db…`) is deprecated.
- 15/15 forge tests green (9 VERI incl. zero-premine assertions + 6 registry).

## [0.4.1] - 2026-08-29

### Added — self-hosted public deployment

- **Live on yuncai.site** (Tencent Cloud + Docker Compose + nginx):
  - Dashboard: `https://yuncai.site/webmcp` (Next.js `basePath=/webmcp`,
    `lib/paths.ts` shared with client fetches)
  - MCP server: `https://yuncai.site/mcp` (streamable HTTP, SSE unbuffered)
  - Discovery doc: `https://yuncai.site/.well-known/mcp.json`
- `deploy/server/docker-compose.yml` + `deploy/server/nginx-webmcp-locations.conf`.

### Fixed

- **viem RPC hardening**: all clients now use a 5s-timeout, zero-retry
  transport (`rpcHttp`); the blockchain status probe runs `getChainId` +
  `hasContract` in parallel under a 6s hard deadline. Before this, a dead
  BSC RPC endpoint made `/api/health` take ~41s instead of ~1s.
- Default BSC testnet RPCs point to publicnode / bnbchain.org / drpc
  (the legacy `data-seed-prebsc-*.binance.org` endpoints are frequently
  unreachable from cloud servers).

## [0.4.0] - 2026-08-28

### Added — Verifiable Web Evidence Network (full stack)

- **Evidence network on BSC Testnet (live)**:
  - `EvidenceRegistry` deployed at `0xD4F14929A1694932439DDa1D481aA127f80185D7`
    (verified anchor TX on BscScan).
  - **VERI** BEP-20 reward token at `0x4FF843Db5196B3Ca7438ABe6E3d6FC16d94350Da`
    (100M supply, owner mint for rewards).
  - Validator vote system (`/api/validate/[id]`): correct votes mint 100 VERI,
    successful challenges (contradicting a previously-supported claim) mint 200.
  - ERC-8004 agent identity: registered on the official BSC Testnet Identity
    Registry (`0x8004A818…BD9e`) as **agentId 2006** — zero contract deployment.
- **BNB Greenfield decentralized storage (spec §27)**: new `packages/storage`
  publishes canonical evidence JSON content-addressed (objectName = sha256) to
  Greenfield testnet; anchor writes the real decentralized URI on-chain.
- **Multi-provider search aggregation**: DuckDuckGo primary with Bing + Baidu
  HTML fallbacks, URL dedupe, `SEARCH_PROVIDER` switch.
- **Dashboard**: evidence list/detail pages, statistics grid, validator
  leaderboard (`/validators`), evidence timeline, one-click demo runner,
  on-chain anchor feed (live `exists()` verification), agent identity card,
  evidence list filtering, Export JSON.
- **MCP server**: 8 tools (4 web + 4 evidence), all with doc-rich metadata,
  annotations and typed input schemas; `/.well-known/mcp.json`; SSRF
  protection; Python 50 tests.
- **Quality**: Playwright e2e (4 offline flows + CI job), full monorepo CI
  (Python + Node), strict typing throughout (mypy/tsc), 80+ tests green.


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

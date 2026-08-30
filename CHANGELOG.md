# Changelog

All notable changes to `free-web-mcp` are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.6] - 2026-08-30

### Added — V6 challenge bond settlement (economically-risked disputes)

- `settleChallengeBonds` runs at finalize: a winning challenger gets their
  bond back plus a reward (`challengerRewardFraction × bond`) and a
  reputation bump; a losing challenger forfeits the bond and takes a
  reputation hit.
- `Challenge` gains `bondSlashed` + `bondReward`; persisted to SQLite (ALTER
  migration) and reflected on the returned API state.
- Validators now track `successful_challenges` + reputation for challengers,
  closing the economic loop that previously stopped at the state flag with
  no financial consequence.
- 2 web tests: losing challenger (bond slashed, 0 challenges) and winning
  challenger (5 VERI reward, reputation 1.0) — 81 total across the monorepo.

## [0.5.5] - 2026-08-30

### Added — V5 MCP protocol tools: agents as independent evidence producers

- 3 new MCP tools → **11 total**: `get_claim_state`, `attest_claim`,
  `challenge_claim` let AI agents submit staked, metadata-rich attestations
  (model / searchProvider / sources), dispute claims, and query lifecycle
  state through the MCP interface.
- `EvidenceApiClient` (Python) gains the three protocol methods; write tools
  registered with `readOnlyHint=False`; the dashboard protocol API stays the
  single owner of storage and chain writes.
- Server deployment now points `EVIDENCE_API_URL` at
  `http://web:3000/webmcp` (the dashboard basePath) so MCP→dashboard calls
  work in the container network.
- Live verified: EV-000020 was created and attested entirely through the
  public MCP endpoint — model `gpt-4o`, provider `bing`, sources
  `["https://example.com/v5"]` round-trip via `get_claim_state`.
- 4 new MCP tests (tool list, protocol calls, error wrapping): 50→54.

## [0.5.4] - 2026-08-30

### Added — V4 oracle-ladder tier escalation (teacher §21/§33)

- `determineResolutionTier(claim, finalProbability, method)` — the oracle
  ladder is now actually computed instead of hardcoded `L2_AI_VALIDATORS`:
  - no challenge / optimistic finalize → L2
  - challenge + clear consensus (|p−0.5| ≥ 0.1) → L2
  - challenge + high disagreement (|p−0.5| < 0.1) → L3_ECONOMIC_DISPUTE
  - challenge + extreme disagreement (|p−0.5| < 0.05) → L4_HUMAN_EXPERT
  - CRYPTOGRAPHIC method → L0
- Both resolution paths (optimistic + consensus) record the dynamic tier;
  the tier round-trips through SQLite and is shown on the dashboard.
- New tests: 7 evidence ladder cases + 1 web tier round-trip (56→63
  evidence… 56 evidence, 14→15 web; 80 total).

## [0.5.3] - 2026-08-30

### Added — V3 reputation-weighted consensus (teacher §9-§10 + §12-§13 closed loop)

- `Attestation.reputation` — the validator's running average of (1 − Brier)
  captured as a snapshot at attestation time (before this bet settles), so a
  well-calibrated expert's voice is weighted higher than a newcomer's.
- Consensus influence is now **stake × independence × (1 + reputation)**;
  reputation is clamped to [0,1] so no weight-amplification exploit. A
  perfectly calibrated validator (rep 1.0) carries 2× a brand-new one.
- `attestClaim` reads the validator's current reputation from the validators
  table and stamps it on the attestation; DB schema + migration add the
  `reputation` column; the finalize resolution root now includes model /
  searchProvider / sources / reputation so the weighted outcome is
  recomputable.
- Dashboard shows a `rep X.XX` badge per attestation.
- New tests: 3 evidence consensus cases (expert outweighs, expert flips the
  outcome, clamp prevents exploits) + 1 web round-trip test (49→52 evidence,
  13→14 web; 74 total).

## [0.5.2] - 2026-08-30

### Added — full four-dimension independence correlation (teacher §13)

- `attestationCorrelation` now covers the complete teacher list: same agent
  (1.0), same `model` (0.7), same `searchProvider` (0.5), overlapping `sources`
  read (0.5 × Jaccard over the page set, trailing-slash normalized), same
  `policy` (0.3) — capped at 1.0.
- `Attestation` gains `searchProvider` and `sources` fields; `policy` is now
  actually **persisted** (it previously existed on the type but was dropped by
  the SQLite layer, so policy correlation never fired on dashboard data).
- DB migration adds `policy` / `search_provider` / `sources` columns to
  existing attestations tables; attest API accepts all three; dashboard shows
  provider + sources per attestation and has a Search Provider form field.
- New tests: 5 correlation dimension cases (evidence) + 1 web round-trip test
  proving provider/sources persist and drive `effectiveVotes` (2.0 for a
  bing-bing-exa split).

## [0.5.1] - 2026-08-30

### Added — V2 independence-weighted consensus (teacher §12-§13)

- `attestationCorrelation(a, b)`: dependency heuristic — same agent = 1.0,
  same `model` = 0.7, same `policy` = 0.3 (capped at 1.0).
- `computeIndependence(attestations)`: per-attestation score = 1 − max
  pairwise correlation. 100 same-model agents ≈ 1 information source.
- `effectiveVotes(attestations)`: Σ independence — the effective number of
  independent votes behind a claim.
- Consensus resolution now weights by **stake × independence** instead of raw
  stake, so a correlated swarm can no longer dominate a diverse minority.
  `ClaimResolution.effectiveVotes` records the true independent vote count.
- Dashboard: model field in attest form, model shown per attestation,
  resolution shows "N attestations → X.XX effective independent votes".
- Bugfix: attestation/challenge ids now include a random suffix —
  `Date.now()` alone collided for rapid submissions and silently overwrote
  rows via the upsert.

## [0.5.0] - 2026-08-30

### Added — Verifiable Knowledge Protocol V1 (teacher's framework)

- **Six core objects**: Claim / Evidence / Attestation / Challenge /
  Resolution / Citation with a formal claim state machine
  (DRAFT → OBSERVED → SUPPORTED → CHALLENGED → DISPUTED → RESOLVED → FINAL).
- **Optimistic resolution engine**: attestations carry confidence + VERI
  stake; a challenge window opens on first attestation; unchallenged claims
  finalize optimistically, challenged claims resolve via stake-weighted
  consensus — wrong attestors are slashed, correct ones rewarded.
- **On-chain resolution anchor**: EvidenceRegistry gained resolveClaim /
  getResolution / isResolved (one tx per finalized claim, resolutionRoot =
  sha256 over attestations + challenge + outcome). Redeployed to BSC
  Testnet at 0x19AB142cA0Aad02BB55ffB6129494926c520c60F.
- **Citation Envelope API**: GET /api/claims/[id]/citation — the verifiable
  reference (claim + quote + evidence refs + resolution state + anchor) that
  AI responses can carry instead of full packages (teacher §19-§22).
- **ProtocolPanel** on evidence detail: lifecycle badge, attestation list
  with slash/reward marks, and the V1 actions (attest / challenge /
  finalize+anchor).
- **Brier-score reputation**: on finalize, each attestor's confidence is
  scored against the outcome via a strictly proper scoring rule; the
  validator's reputation becomes the running average of (1 - brier).
- 52 Node tests + 21 forge tests green.

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
  - `EvidenceRegistry` deployed at `0x19AB142cA0Aad02BB55ffB6129494926c520c60F`
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

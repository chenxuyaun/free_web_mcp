# Free Web MCP — Verifiable Web Evidence Network

> Give AI agents free web access, **verify the evidence behind web-derived
> claims**, and **anchor evidence fingerprints on BNB Smart Chain (Testnet)**.

```
AI Agent → MCP → Web Search → Web Fetch → Claim Extraction → Evidence Collection
  → Cross Verification → Counter Evidence → Evidence Package → SHA-256
  → BSC Testnet (EvidenceRegistry) → Dashboard
```

**Live demo** (local): `pnpm dev` → http://localhost:3000

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chenxuyaun/free_web_mcp)

**Don't trust this README?** Every on-chain claim has a credential-free public
proof — see [docs/VERIFICATION.md](docs/VERIFICATION.md).

---

## What this project is

A monorepo with two halves:

| Half | What | Stack |
| --- | --- | --- |
| **Web evidence pipeline** | claim extraction, source scoring, verification, counter-evidence directions, canonical SHA-256 hashing | Node 22 / TypeScript / pnpm |
| **Dashboard + API** | live status board, evidence list/detail, statistics, one-click demo, **Anchor Evidence** (writes the hash on-chain) | Next.js 14 / React / Tailwind / better-sqlite3 |
| **MCP server** | the 8-tool MCP server (`web_search`, `web_fetch`, `web_search_and_fetch`, `web_summarize_with_sources`, `extract_claims`, `find_counter_evidence`, `create_evidence_record`, `get_evidence`) | Python 3.12 / FastMCP / DuckDuckGo |
| **Smart contract** | `EvidenceRegistry` — register / lookup / de-duplicate evidence fingerprints | Solidity 0.8.24 / Foundry / viem |

All evidence packages are **persisted in SQLite** (`apps/web/data/evidence.db`) and
can be **anchored on-chain** — the on-chain record stores only the SHA-256 hash
+ URI + version + submitter + timestamp, never the full content.

## Milestones (computed live on the dashboard)

MCP Server · Web Search · Web Fetch · Evidence Engine · First Evidence ·
Blockchain Registry · First On-chain Record · Dashboard · Validator ·
VERI Test Token

---

## Quick start

### 1. Install

```bash
# Node side
pnpm install

# Python side (MCP server)
cd apps/mcp-server && uv sync && cd ../..
```

### 2. Run everything (3 terminals)

```bash
# Terminal 1 — Python MCP server (port 8765)
cd apps/mcp-server && uv run --no-sync free-web-mcp --transport http --host 127.0.0.1 --port 8765

# Terminal 2 — Next.js dashboard (port 3000)
pnpm dev

# Terminal 3 — local blockchain (Anvil, port 8545) — optional for anchoring
anvil --port 8545
```

### 3. See it work

- **Dashboard**: http://localhost:3000 — System Online, live status probes,
  evidence statistics, **Run Demo** button (search → fetch → extract → verify → hash).
- **CLI demo**: `pnpm demo` prints the same pipeline.
- **Evidence records**: http://localhost:3000/evidence and `/evidence/EV-XXXXXX`.
- **Anchor on-chain** (needs a contract): click **Anchor Evidence** on a detail
  page, confirm, and the hash is registered on the EvidenceRegistry.

### Environment

Copy `.env.example` → `.env.local` (web) / `.env` (mcp-server). Key vars:

| Var | Purpose |
| --- | --- |
| `BSC_RPC_URL` | Chain RPC (Anvil `http://127.0.0.1:8545` or BSC Testnet) |
| `EVIDENCE_REGISTRY_ADDRESS` | Deployed contract address (after `forge script`) |
| `WALLET_PRIVATE_KEY` | Server-side signer for anchoring (**never** in frontend/logs) |
| `MCP_SERVER_URL` | Where the dashboard finds the MCP server (`http://127.0.0.1:8765`) |

> **Private keys must never be committed, logged, or sent to the frontend.**
> See [SECURITY.md](SECURITY.md).

---

## Smart contract (Phase 5)

```bash
cd contracts
forge build
forge test          # 6 tests
# local Anvil
anvil --port 8545 &
forge script script/Deploy.s.sol:DeployEvidenceRegistry \
  --rpc-url http://127.0.0.1:8545 --broadcast
# BSC Testnet (needs tBNB — never use a real key)
forge script script/Deploy.s.sol:DeployEvidenceRegistry \
  --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545 \
  --private-key $PRIVATE_KEY --broadcast
```

The deployed address goes into `.env.local` as `EVIDENCE_REGISTRY_ADDRESS`.
The dashboard then flips `Blockchain → CONNECTED` and the Anchor button works.

### Live deployment (BSC Testnet)

| | |
| --- | --- |
| Contract | `0xD4F14929A1694932439DDa1D481aA127f80185D7` |
| Network | BSC Testnet (chainId 97) |
| Deploy TX | [0xe8aa0919…ffd1](https://testnet.bscscan.com/tx/0xe8aa0919462ae32101b06f3bcfb727fba1ba1ae2bb446d37079531d54c54ffd1) |
| Anchor TX (EV-000006) | [0xe8aa0919…ffd1](https://testnet.bscscan.com/tx/0xe8aa0919462ae32101b06f3bcfb727fba1ba1ae2bb446d37079531d54c54ffd1) |
| Verify | `cast call <contract> "exists(bytes32)(bool)" 0x3112…f3db8 --rpc-url <testnet-rpc>` → `true` |

---

## MCP tools (Python server)

| Tool | Description |
| --- | --- |
| `web_search(query, max_results)` | DuckDuckGo search; each result has `source_domain` + `confidence` |
| `web_fetch(url, rendered?)` | Fetch + extract main text; returns `meta` (domain_type, https, published_at, author…) |
| `web_search_and_fetch(query, max_results, rendered?)` | Search then fetch Top-N in one call |
| `web_summarize_with_sources(url, html?, max_links?)` | Classify outgoing links primary/secondary/tertiary |
| `extract_claims(text)` | Split text into claims, classify fact/event/number/date/relationship/opinion/inference |
| `find_counter_evidence(claim)` | Generate counter-evidence search directions |
| `create_evidence_record(claim, supporting, contradicting?, cross_verified?)` | Build + persist an evidence package via the dashboard API |
| `get_evidence(id)` | Fetch a persisted evidence package |

All errors return `{success:false, error:{type, message}}` with a stable
`type` (INVALID_URL, FETCH_FAILED, TIMEOUT, HTTP_ERROR, PARSER_ERROR,
SEARCH_FAILED, RATE_LIMITED, CONTENT_TOO_LARGE, RENDER_FAILED,
RENDER_TIMEOUT, INTERNAL_ERROR).

---

## Architecture

```
┌─────────────┐   ┌───────────────────────────────┐
│ MCP Clients │──▶│ apps/mcp-server (Python)      │
│ Cursor /    │   │ 8 tools, error-wrapped        │
│ Claude /    │   └───────────────┬───────────────┘
│ ChatGPT     │                   │ MCP_SERVER_URL
└─────────────┘                   ▼
┌─────────────────────────────────────────────────┐
│ apps/web (Next.js dashboard + API)              │
│  /api/evidence  create/list/stats               │
│  /api/evidence/[id]  detail                     │
│  /api/demo/run   one-click demo pipeline        │
│  /api/anchor/[id]  on-chain write (confirm req) │
│  SQLite: apps/web/data/evidence.db              │
└──────────────┬────────────────┬─────────────────┘
               │                │
               ▼                ▼
┌──────────────────────┐  ┌─────────────────────────┐
│ packages/evidence    │  │ packages/blockchain     │
│ claims / engine /    │  │ viem client for         │
│ canonical SHA-256    │  │ EvidenceRegistry        │
└──────────────────────┘  └────────────┬────────────┘
                                       ▼
                        EvidenceRegistry.sol (contracts/)
                        BSC Testnet (97) or Anvil (31337)
```

Layering rule: MCP tools never touch storage or chain directly — they call the
dashboard API; the dashboard owns SQLite + the on-chain signer.

---

## Testing

```bash
# Python (44 + SSRF tests)
cd apps/mcp-server && uv run pytest -q

# Node (evidence engine 15, blockchain, web db 6)
pnpm -r test

# Type checks
pnpm -r typecheck
cd apps/mcp-server && uv run mypy
```

CI runs all of the above on every push — see [.github/workflows/ci.yml](.github/workflows/ci.yml).

---

## Security

See [SECURITY.md](SECURITY.md) — SSRF protection, private-key handling,
threat model, what is and isn't logged. Key points:

- `WebClient` rejects private/local/link-local addresses (SSRF, spec §30).
- Rate limits on `/api/demo/run` and `/api/anchor`.
- On-chain writes require explicit `{confirm: true}` and are signed only by
  the server-side wallet from `WALLET_PRIVATE_KEY`.
- No real funds, no mainnet, no promises of exchange listing. Testnet only.

---

## Roadmap

- **v0.3 (done)**: dashboard + evidence engine + SQLite + 8 MCP tools +
  EvidenceRegistry contract (BSC Testnet: `0xD4F1…85D7`) + demo mode +
  SSRF/rate limits.
- **v0.4 (done)**: VERI Test Token (BEP-20, testnet: `0x4FF8…50Da`) +
  validator votes & rewards + multi-provider search aggregation +
  **BNB Greenfield evidence publishing** (§27, content-addressed) +
  **ERC-8004 agent identity** (§28, registered on the official BSC Testnet
  registry, agentId 2006) + Playwright e2e.
- **Next (watchlist)**: ERC-8004 reputation feedback writing (needs a
  second non-owner wallet — the registry blocks self-feedback); agent
  payments (§29) gated on B402/x402 BSC facilitator self-service; BNB
  Greenfield mainnet when ready.

## License

MIT — see [LICENSE](LICENSE).

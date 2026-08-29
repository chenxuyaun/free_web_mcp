# Definition of Done — spec §36 checklist

Every item verified against live state (not hardcoded). Evidence links point to
public, credential-free sources. See [VERIFICATION.md](VERIFICATION.md) for the
full independent-verification card.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Project boots | ✅ | `pnpm dev` → localhost:3000; `/api/health` 10/10 milestones live |
| 2 | MCP server works | ✅ | 8 tools registered; Python 50 tests; `MCP_SERVER ONLINE` probe |
| 3 | AI can call web_search | ✅ | DuckDuckGo/Bing/Baidu aggregation; 5/5 real searches returned results |
| 4 | AI can call web_fetch | ✅ | Wikipedia extraction 10,880 chars, meta block included |
| 5 | Web content extraction works | ✅ | trafilatura + BS4 fallback; parser tests |
| 6 | Claims can be extracted | ✅ | 7-type classifier (fact/event/number/date/relationship/opinion/inference) |
| 7 | Evidence can be collected | ✅ | EvidenceEngine + SQLite persistence (6 db tests) |
| 8 | Counter evidence can be collected | ✅ | search-direction generator + CONTRADICTED status path |
| 9 | Verification status works | ✅ | SUPPORTED/LIKELY_TRUE/UNCERTAIN/CONTRADICTED/INSUFFICIENT_EVIDENCE |
| 10 | Evidence Package generated | ✅ | full spec §14 schema incl. provenance + counterEvidence |
| 11 | SHA-256 generated | ✅ | canonical JSON → 64-hex; same→same / changed→different tests |
| 12 | Solidity tests pass | ✅ | forge: 15 tests (6 registry + 9 VERI) |
| 13 | BSC Testnet contract deployed | ✅ | `0xD4F1…85D7` ([BscScan](https://testnet.bscscan.com/address/0xD4F14929A1694932439DDa1D481aA127f80185D7)) |
| 14 | Evidence can be anchored | ✅ | Anchor API + button; confirmed flow with `{confirm:true}` |
| 15 | TX hash displayed | ✅ | detail page + [anchor TX](https://testnet.bscscan.com/tx/0xd31f15ca25b5cdf24afa6764d8b9ef00546d4050c4714501a9d1376b4075d668) |
| 16 | Explorer link works | ✅ | BscScan links throughout detail page + on-chain feed |
| 17 | Dashboard works | ✅ | status board / stats / evidence / validators / agent card |
| 18 | Demo Mode works | ✅ | `/api/demo/run` + Run Demo button + `pnpm demo` CLI |
| 19 | Security tests pass | ✅ | SSRF (private-IP block) + rate limits + error taxonomy tests |
| 20 | README complete | ✅ | architecture, install, env, demo, contract, roadmap |

## Beyond the spec MVP (bonus, all live)

| Item | Evidence |
| --- | --- |
| BNB Greenfield decentralized publish (§27) | [public evidence JSON](https://gnfd-testnet-sp1.bnbchain.org/view/free-web-mcp-evidence2/8a137c429eaae063fe0db8170d681221040c0aa3cc417e84ee3a0d3e8973e579.json) |
| ERC-8004 agent identity (§28) | agentId 2006 on official registry ([mint TX](https://testnet.bscscan.com/tx/0x5261cbd0844cfebc02b2b8d398e69555b0393fb047951430f5a0c576f68f5738)) |
| Reputation feedback loop (§28) | value 95 from independent wallet ([TX](https://testnet.bscscan.com/tx/0x8e2034be4cb94ca7226f291749e176e2714e13de121f49ad4f15a5b9b8277ba1)) |
| VERI reward token + validator rewards (§24-26) | [token](https://testnet.bscscan.com/token/0x4FF843Db5196B3Ca7438ABe6E3d6FC16d94350Da); correct vote → 100 VERI mint |
| Multi-provider search aggregation | DuckDuckGo + Bing + Baidu fallback, URL dedupe |
| Playwright e2e + CI (Python/Node/e2e jobs) | [Actions](https://github.com/chenxuyaun/free_web_mcp/actions) — all green |

## Not done (honest)

| Item | Why |
| --- | --- |
| Payments (§29, MPP/ERC-8183/x402) | B402 facilitator not self-service yet; ERC-8183 is spec-only. Watchlist. |
| Organic third-party reputation | The 95-value feedback is from our own second wallet — mechanism demo. |
| Render permanent URL | One-click button in README; requires account owner to click through. |

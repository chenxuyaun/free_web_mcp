# Definition of Done — spec §36 checklist

Every item verified against live state (not hardcoded). Evidence links point to
public, credential-free sources. See [VERIFICATION.md](VERIFICATION.md) for the
full independent-verification card.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Project boots | ✅ | `pnpm dev` → localhost:3000; `/api/health` 10/10 milestones live |
| 2 | MCP server works | ✅ | 13 tools registered; Python 56 tests; `MCP_SERVER ONLINE` probe |
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
| 13 | BSC Testnet contract deployed | ✅ | `0xD4F1…85D7` ([BscScan](https://testnet.bscscan.com/address/0x19AB142cA0Aad02BB55ffB6129494926c520c60F)) |
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
| VERI reward token + validator rewards (§24-26) | [token](https://testnet.bscscan.com/token/0xDDcbC86dE41bB8863a4Acd929E965d0E07A54C76); correct vote → 100 VERI mint |
| Multi-provider search aggregation | DuckDuckGo + Bing + Baidu fallback, URL dedupe |
| Playwright e2e + CI (Python/Node/e2e jobs) | [Actions](https://github.com/chenxuyaun/free_web_mcp/actions) — all green |

## Verifiable Knowledge Protocol (teacher framework, V1-V11)

The full protocol layer built on the spec MVP — six core objects, optimistic
verification, staking/slashing, proper scoring, independence weighting,
oracle ladder, and agent participation. All live-verified on yuncai.site.

| Milestone | What | Live evidence |
| --- | --- | --- |
| V1 | Six core objects + claim state machine + optimistic verification + Brier reputation + citation envelope | EV-000014: create→OBSERVED→attest→SUPPORTED→challenge→CHALLENGED→finalize→RESOLVED, on-chain tx + Brier settle 0.99 |
| V2 | Independence scoring + effective_votes (teacher §12-§13) | EV-000015: two same-model votes (0.3 indep each) outweighed by one diverse (1.0) → outcome flipped; effectiveVotes 1.6 |
| V2.5 | Four-dimension correlation: model / searchProvider / sources / policy | EV-000016: bing-pair + exa singleton → effectiveVotes 2, bing-pair slashed |
| V3 | Reputation-weighted consensus: stake × independence × (1+rep) | EV-000018: high-rep expert (1.295) flipped 0.533→0.5 against two newcomers |
| V4 | Oracle ladder tier escalation: clear→L2, sharp→L3, knife-edge→L4 | EV-000019: 0.52 vs 0.48 → L4_HUMAN_EXPERT, anchored |
| V5 | MCP protocol tools: get_claim_state / attest_claim / challenge_claim (11 tools) | EV-000020: created + attested entirely via MCP, model/provider/sources round-trip |
| V6 | Challenge bond settlement: winner bond+reward, loser forfeits | EV-000021: challenger won → bond back + 5 VERI reward + rep 1.0 |
| V7 | On-chain resolution verification (recomputable root) | EV-000021 verify: verified=true, root matched |
| V8 | MCP finalize_claim: agents run the whole lifecycle (12 tools) | EV-000022: create→attest→challenge→finalize→anchor via MCP only |
| V9 | MCP verify_claim (13 tools) | EV-000022 verify via MCP: verified=true |
| V10 | Configurable proper scoring rules: brier / log (teacher §9-§10) | EV-000024: log rule settled rep exactly 0.9 for 0.9-confident correct |
| V11 | Playwright e2e protocol lifecycle flow | 5 e2e tests pass (chromium) + CI e2e job |

| V13 | Oracle ladder: knife-edge disputes resolve INDETERMINATE (no coin-flip) | EV-000025: 0.52 vs 0.48 → INDETERMINATE, HUMAN_ARBITRATION, not anchored |
| V14 | Knife-edge stays DISPUTED — more independent validators can break it | EV-000026: DISPUTED → third validator → RESOLVED (FALSE), challenge UPHELD |
| V15 | Citation envelope UI — one-click copy for AI consumption | yuncai.site evidence detail page, §19-§22 |
| V16 | MCP get_citation tool (14 tools) | EV-000026 citation via public MCP endpoint |

| V17 | Real source quotes in citation envelopes (§19-§22) | EV-000027: citation returns verbatim source quote + quoteHash |
| V18 | Prediction market aggregation — log-odds belief pool (§25-§27) | EV-000028: market 0.8223 vs weighted avg 0.6633, method PREDICTION_MARKET |

| V19 | Human-expert arbitration (L4 oracle ladder) | EV-000029: DISPUTED → expert TRUE → HUMAN_ARBITRATION, on-chain verified |

## Not done (honest)

| Item | Why |
| --- | --- |
| Payments (§29, MPP/ERC-8183/x402) | B402 facilitator not self-service yet; ERC-8183 is spec-only. Watchlist. |
| Organic third-party reputation | The 95-value feedback is from our own second wallet — mechanism demo. |
| Render permanent URL | One-click button in README; requires account owner to click through. |

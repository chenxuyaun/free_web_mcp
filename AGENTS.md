# AGENTS.md

## 项目状态

**Free Web MCP — Verifiable Web Evidence Network**：给 AI Agent 免费网页访问，对网页来源的断言做**证据化验证**，并把证据指纹 **SHA-256 锚定到 BNB Smart Chain Testnet**。双栈 pnpm monorepo。

**当前进度（v0.3，M4-M8 已完成）**：dashboard + evidence engine + SQLite 持久化 + 8 个 MCP 工具 + EvidenceRegistry 合约（Anvil 本地链验证锚定 exists()=true）+ Demo Mode + SSRF/限流。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端/Dashboard | Next.js 14 / React 18 / Tailwind / better-sqlite3 / lucide |
| 证据引擎 | TypeScript（`packages/evidence`）+ Vitest |
| 链上 | Solidity 0.8.24 / Foundry / viem（`packages/blockchain` + `contracts/`） |
| MCP Server | Python 3.12 / FastMCP / DuckDuckGo（`apps/mcp-server`，uv 管理） |
| 包管理 | pnpm workspace + uv（Python 侧独立） |

## 目录

```
apps/
  web/            Next.js dashboard + API 路由（evidence/demo/anchor/health）
  mcp-server/     Python MCP server（8 工具，44+ 测试）
packages/
  evidence/       claims/engine/hash/package（TS，15 vitest）
  blockchain/     viem client for EvidenceRegistry（chains/registry）
contracts/        EvidenceRegistry.sol + forge test（6 测试）
scripts/          seed-demo.ts、demo.ts（pnpm demo）
docs/             ｜examples/ ｜.github/workflows/ci.yml
```

## 分层规则（必须遵守）

- **MCP 工具层**（apps/mcp-server/src/free_web_mcp/mcp/tools.py）**绝不直接**碰存储或链——`extract_claims`/`find_counter_evidence` 是本地纯函数，`create_evidence_record`/`get_evidence` 走 dashboard API（`MCP_SERVER_URL` 环境变量）。
- **Dashboard API 层**拥有 SQLite（`apps/web/lib/db.ts`）和链上签名器（`apps/web/lib/blockchain.ts`）。
- **链上写操作**必须：服务端 signer（`WALLET_PRIVATE_KEY` 只从 env 读）+ 请求显式 `{confirm:true}` + 限流。
- **SSRF 防护**在 `apps/mcp-server/src/free_web_mcp/web/client.py`：拒绝 localhost/私网/链路本地地址。
- 私钥**永不**入代码/日志/前端/MCP 输出。

## 关键命令

```bash
pnpm install                        # Node 依赖
cd apps/mcp-server && uv sync       # Python 依赖

# 三个终端跑起来
cd apps/mcp-server && uv run --no-sync free-web-mcp --transport http --host 127.0.0.1 --port 8765
pnpm dev                            # dashboard :3000
anvil --port 8545                   # 本地链（锚定用）

pnpm demo                           # CLI 演示（需 8765 + dashboard 在跑）
cd contracts && forge test          # 合约测试
pnpm -r test && pnpm -r typecheck   # Node 测试/类型
cd apps/mcp-server && uv run pytest -q   # Python 测试
```

## 开发纪律

- 每个里程碑（M4→M8）完成必须**跑通并展示成果**（dashboard 可见 / 链上可查）再进下一个。
- 提交用 Conventional Commits。
- `.env.local`（web）/`.env`（mcp-server）绝不入库；`apps/web/data/`（SQLite）不入库。
- CI：`.github/workflows/ci.yml`（Python job + Node job）全绿才合入。

## 状态探测约定

Dashboard 的 `apps/web/lib/status.ts` 所有状态都是**实时探测**（MCP /health、SQLite count、合约地址配置），禁止硬编码 "ONLINE"。"没有反证 ≠ 证明为真"（CONTRADICTED/INSUFFICIENT_EVIDENCE 语义正确）。

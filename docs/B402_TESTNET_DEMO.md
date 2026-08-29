# B402 支付演示 — BSC Testnet 端到端验证记录（Phase P spike）

> 状态：**testnet 演示链路已跑通**（2026-08-29）。官方 B402 生产接入走申请制
> （邮件已提交 binanceconnect@binance.com，等凭据中）。本 spike 证明
> "x402 式免 gas 支付"在 BSC Testnet 上完全可行，官方凭据到位后可直接替换。

## 结论

x402 免 gas 支付循环在 BSC Testnet 实测成功：

```
Agent 钱包（持有 mUSDT）
   │ ① approve relayer（唯一一次自己付 gas）
   │ ② 离线签 EIP-712 授权（零 gas）
   ▼
Merchant ──③ /verify──► Facilitator（垫 gas）
   │        ④ /settle──► RelayerV2 合约（transferWithAuthorization）
   ▼
代币从 Agent 转到 Merchant，用户全程只付过 approve 那一次 gas
```

## 链上事实（BSC Testnet, chainId 97）

| 项 | 地址 / 哈希 |
| --- | --- |
| MockUSDT（演示代币，public mint，6 位小数） | `0x042EaBe2aFF229EF2d6a51f6295e551e4E105b15` |
| B402RelayerV2（本项目自部署，owner=项目钱包） | `0x9ed76a7F6e160dA253ef8305Ff97d36a10A88B88` |
| 白名单交易 | `0x74a62ddb5f4616301a2be828070cab71a0922f4e7a4499be4e232ffa248b115d` |
| approve 交易（agent，唯一自付 gas） | `0x64a536805680c5f4b92d149287bd097a6a0ce3eaffb3cd9d013875243fa71c5f` |
| **settle 交易（facilitator 垫 gas）** | [0xb968fde6…](https://testnet.bscscan.com/tx/0xb968fde6f3b446b40f23ff9703eaca0e937dfc4da6c95e517f215f7c725c7d21) |

结算交易校验：`to = 0x9ed76a7F…`（我们的 RelayerV2），input 为
`transferWithAuthorization`（0x5bbf47ee）调用，实参 = token + agent + merchant。

## 实测数字

- Agent 代币：30000 → 29999（支付 1 mUSDT）
- Merchant 代币：0 → 1 ✓
- `/verify` 返回 `{"isValid":true,"payer":"0xafb0fc…31C"}`
- `/settle` 返回 `{"success":true,"transaction":"0xb968fde6…","blockNumber":127877197}`

## 怎么复现（spike 代码在 /tmp/b402，未入库）

仓库已归档（2026-04，read-only）且根目录无 LICENSE，所以 spike 代码
**不进入本项目仓库**。复现步骤：

```bash
git clone --depth 1 https://github.com/Vistara-Labs/b402  /tmp/b402
cd /tmp/b402 && npm i && npm i solc @openzeppelin/contracts@^5
cd b402-sdk && sed -i "s|export \* from './simple';||" src/index.ts && npm i && npm run build
cd .. && cp <MockUSDT.sol> contracts/   # 见下方要点
# 1) 部署（MockUSDT + RelayerV2 + 白名单 + 给 agent 打款）
DEPLOYER_PRIVATE_KEY=0x… npx tsx scripts/deploy-demo.ts
# 2) 起 facilitator（:3402）
cd b402-facilitator && npm i
RELAYER_PRIVATE_KEY=0x… B402_RELAYER_ADDRESS=<relayer> \
  NETWORK=testnet BSC_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com \
  npx tsx src/server.ts
# 3) 跑支付流
TEST_USER_PK=<agent pk> TOKEN_ADDRESS=<mock> RELAYER_ADDRESS=<relayer> \
  FACILITATOR_URL=http://localhost:3402 npx tsx ../scripts/demo-e2e-local.ts
```

要点：
- 官方托管 facilitator（facilitator.b402.ai）已下线，SDK 也没发 npm —— 全部自托管；
  其默认 RPC（data-seed-prebsc-*）已死，必须覆盖为 publicnode/drpc。
- MockUSDT 是 30 行的 public-mint ERC20（6 位小数），演示代币，白名单进 relayer。
- 演示用代理钱包全部是 testnet 一次性地址，无真实价值。

## 与官方接入的关系

| | 开源 spike（本页） | 官方 B402（申请中） |
| --- | --- | --- |
| 环境 | BSC Testnet，自部署合约 | Sandbox（testnet）→ Production |
| 身份 | 自托管 facilitator | clientId + RSA 签名 + IP 白名单 |
| 代币 | 任意白名单 ERC20 | USDT / USDC / USD1 |
| 用途 | 演示协议可行性 | 生产接入 |

官方凭据（clientId/accessToken）到位后，产品侧做 `/papi/v2/b402/supported`
+ `/verify` + `/settle` 三件套即可切换，协议语义与本次 spike 一致。

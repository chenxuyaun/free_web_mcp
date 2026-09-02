# B402 官方凭据获取跟踪（Phase P 前置）

> 目标：拿到 Binance OnchainPay x402（B402）Sandbox 凭据：`clientId` +
> `accessToken` + webhook 验证公钥。拿到后做 x402 支付网关（MCP 2.0 迁移
> 一并做，见 B402_TESTNET_DEMO.md）。

## 状态

| 项 | 状态 |
| --- | --- |
| 申请邮件（binanceconnect@binance.com，发件邮箱 **yueshewushuang@gmail.com**） | ✅ 2026-08-29 已发送（Gmail 已发送箱确认，15:47 CST） |
| RSA 密钥对（deploy/b402/，公钥已随邮件提交） | ✅ |
| **跟进邮件**（binanceconnect@binance.com，发件邮箱 yueshen@agent.qq.com） | ✅ 2026-09-02 已发送（第 3 个工作日，正文引用 Gmail 联系邮箱 + issue #28） |
| 官方回信（clientId/accessToken） | ⏳ 等待中（回信会进 Gmail，需转发到 yueshen@agent.qq.com 由 Agent 接管） |
| 开源备胎（自托管 relayer，testnet 已验通） | ✅ 随时可用 |

## 已尝试的通道

| 通道 | 结果 |
| --- | --- |
| Google Form（forms.gle/aUQvxUETfGMzyTky5，文档唯一入口） | ❌ 组织限制，外部账号无法打开 |
| 邮件 binanceconnect@binance.com（文档确认的联系邮箱） | ✅ 已发（唯一可行官方通道）；09-02 无回信后已跟进 |
| Vistara-Labs/b402 仓库（开源实现） | ❌ 已归档只读，无联系人 |
| bnb-chain/mpp-sdk（BNB Chain 官方 SDK） | ✅ [issue #28 已开](https://github.com/bnb-chain/mpp-sdk/issues/28)（2026-08-29，提前于原计划）；09-02 检查仍 open、0 评论 |

## 巡检记录

- **2026-08-31**：三通道（QQ 邮箱收/垃圾、Gmail from:binanceconnect、issue #28）均无回信。
- **2026-09-02**：三通道均无回信（申请后第 3 个工作日）。确认申请邮件在 Gmail
  已发送箱（08-29 15:47）。发送跟进邮件（agent QQ 邮箱 → binanceconnect，
  主题 "Re: B402 / OnchainPay x402 — Sandbox Developer Account Application"，
  正文含申请信息、Gmail 联系邮箱、issue #28 链接）。用户确认后发送。

## 跟进计划

- ~~第 3 个工作日发跟进邮件~~ ✅ 已于 09-02 执行
- **09-05 或之后**：仍无回信则再跟进一次（这次从 Gmail 回复原邮件线程，
  并考虑 BNB Chain 开发者社区 Discord/Telegram 加速）
- 任何回信：把 clientId/accessToken 写入服务器 .env，开做支付网关

## 跟进邮件模板（第 3 个工作日发送）

```text
Subject: Re: B402 / OnchainPay x402 — Sandbox Developer Account Application

Hi Binance Pay Onchain team,

Following up on our application sent on 2026-08-29 for the B402 Sandbox
(BSC Testnet) developer account.

Business name: Free Web MCP (Verifiable Web Evidence Network)
Contact email: <你的邮箱>
Wallet address (testnet): <你的 testnet 钱包地址>
IP whitelist: 124.221.130.64

Could you confirm whether the application is under review, and whether any
additional materials are needed? Happy to provide anything required to
expedite the Sandbox credentials.

Best regards,
<你的名字>
```

## 硬约束（不因着急而妥协）

- 私钥只留在 `deploy/b402/b402_private.pem`（已 gitignore），绝不入邮件/代码/日志
- 只申请 Sandbox（testnet）；Production 等集成测试通过后再申
- 等回信期间不阻塞：开源自托管链路已验通，可随时演示

## 社区询问话术（Discord/Telegram 开发者频道）

```text
Hi! We applied for the B402 / OnchainPay x402 Sandbox (BSC Testnet)
developer account via binanceconnect@binance.com on 2026-08-29, but
haven't heard back. The Google Form in the docs is restricted to
internal org accounts and can't be opened from outside. Is there an
alternative self-service onboarding path, or the right channel to
escalate a Sandbox credential request? Happy to provide business
details (Free Web MCP — MCP server monetization, testnet wallet
0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4). Thanks!
```

官方社区入口（需自行确认最新邀请链接）：BNB Chain Discord
（discord.gg/bnbchain）、Telegram（t.me/bnbchain）、Binance Developers
（developers.binance.com 上的社区/支持入口）。

## 2026-08-29 补充调研（Binance Agent OS / Agentic Payments）

- **Binance Agent OS 2026-08-20 上线**：打包 Binance API、Wallet Agentic Hub、
  Binance x402 可编程支付、Skill Hub、MCP 支持（agent.binance.com/mcp/agentic）。
- **Agentic MCP 端点**：自助接入（OAuth、无 API key、无审批），但是**交易域**
  （读行情/查余额/交易），与商户支付无关。
- **Agentic Payments（x402 商户侧）**：文档确认**仍是审批制**——"基于 Binance
  确认的集成范围"，联系渠道仍是 binanceconnect@binance.com。
- **结论**：不存在绕过审批的自助商户通道；邮件申请是唯一正确路径，等待回信
  就是唯一状态。09-03 自动化为双通道监控（邮箱 + issue #28）。

## 2026-08-29 深夜：Gmail 实查确认（通过用户登录中的 Chrome，只读）

- 申请邮件确认发出：2026-08-29 15:47，发件人 yueshewushuang@gmail.com，
  主题 "B402 / OnchainPay x402 — Sandbox Developer Account Application"。
- 三路搜索（from:binanceconnect@binance.com / in:spam binance /
  in:anywhere binance）均无回信；Gmail 中 binance 邮件最新一条就是申请邮件本身。
- 结论：申请已送达，Binance 尚未回信。回信到达后需转发到 yueshen@agent.qq.com。

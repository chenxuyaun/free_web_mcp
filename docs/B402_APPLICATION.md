# B402 官方凭据获取跟踪（Phase P 前置）

> 目标：拿到 Binance OnchainPay x402（B402）Sandbox 凭据：`clientId` +
> `accessToken` + webhook 验证公钥。拿到后做 x402 支付网关（MCP 2.0 迁移
> 一并做，见 B402_TESTNET_DEMO.md）。

## 状态

| 项 | 状态 |
| --- | --- |
| 申请邮件（binanceconnect@binance.com） | ✅ 2026-08-29 已发送 |
| RSA 密钥对（deploy/b402/，公钥已随邮件提交） | ✅ |
| 官方回信（clientId/accessToken） | ⏳ 等待中 |
| 开源备胎（自托管 relayer，testnet 已验通） | ✅ 随时可用 |

## 已尝试的通道

| 通道 | 结果 |
| --- | --- |
| Google Form（forms.gle/aUQvxUETfGMzyTky5，文档唯一入口） | ❌ 组织限制，外部账号无法打开 |
| 邮件 binanceconnect@binance.com（文档确认的联系邮箱） | ✅ 已发（唯一可行官方通道） |
| Vistara-Labs/b402 仓库（开源实现） | ❌ 已归档只读，无联系人 |
| bnb-chain/mpp-sdk（BNB Chain 官方 SDK） | 无接入指引，可试 GitHub issue |

## 跟进计划

- **第 3 个工作日**（约 09-03）：无回信则发跟进邮件（模板见下）
- **第 7 个工作日**（约 09-09）：跟进邮件 + 在 bnb-chain/mpp-sdk 开 issue
  询问 Sandbox 接入指引
- **并行**：加入 BNB Chain 开发者社区（Discord/Telegram）问 B402 接入，
  社区经理常能加速
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

---
name: btc-radar
description: Use when the user wants a pre-trade safety / honeypot / rug check on a Base or BSC token contract, a list of newly launched Bitcoin L1 tokens (BRC-20, Runes, Alkanes, Stamps), or a deep-dive on one of those projects. Calls the x402-btc-radar MCP tools, which cost $0.01–$0.05 USDC per call paid from the user's own Base wallet.
---

# BTC Radar & Token Risk（x402 付费工具）

## 何时用
- 用户给出一个 Base / BSC 代币合约地址，问“能不能买 / 是不是貔貅(honeypot) / 有没有跑路风险 / 税多少” → `token_risk`
- 一次查 2–10 个代币 → `token_risk_batch`（一次 $0.05，比逐个查便宜）
- 问“比特币生态最近有什么新项目 / 新铭文 / 新符文” → `btc_radar_latest`
- 对雷达里的某个项目要详情 → `project_info`（slug 取自 `btc_radar_latest` 结果）
- 只想确认服务是否在线 → `health`（免费）

## 价格（Base 主网 USDC，x402，按次）
| 工具 | 价格 |
|---|---|
| health | 免费 |
| token_risk | $0.01 |
| token_risk_batch（≤10 个） | $0.05 |
| btc_radar_latest | $0.01 |
| project_info | $0.05 |

## 规则
1. **付费前先告诉用户价格**，除非用户已明确同意按次付费。能批量就用 `token_risk_batch`。
2. 不要编造地址；地址必须是 `0x` + 40 位十六进制，链只能是 `base` 或 `bsc`。参数错误时上游返回 400 且不收费。
3. 工具返回 `payment_required`：说明用户还没配钱包。把价格告诉用户，并提示在 MCP 服务器环境里设置 `X402_PRIVATE_KEY`（用户自己的 Base 钱包私钥，需少量 USDC，不需要 ETH），或改用任意 x402 客户端通过 CDP Bazaar 直接调用。**绝不要索要或在对话里显示私钥。**
4. 工具返回 `payment_refused`：报价没通过安全校验（收款地址/网络/资产不对或超过 `MAX_PAYMENT_USD` 上限）。原样告诉用户原因，不要尝试绕过。
5. 结果展示：先给结论（verdict、score、action），再列 2–5 条关键理由；注明 `missing` / `sources_failed` 中缺失的数据。
6. 始终附上：**不构成投资建议（Not investment advice）**。

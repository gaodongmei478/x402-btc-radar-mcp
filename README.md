# x402-btc-radar — Agent Plugin（MCP + Skill）

把 **BTC Radar / Token Risk** x402 付费 API 包成 AI 助手可直接调用的插件。
上游：`https://x402-btc-radar.jinli-x402.workers.dev`（Base 主网 USDC，已收录 Coinbase CDP x402 Bazaar）。

**调用方用自己的钱包付费。本插件不含任何私钥或密钥。**

## 工具与价格

| MCP 工具 | 上游路由 | 价格（USDC，Base） |
|---|---|---|
| `health` | `GET /health` | 免费 |
| `token_risk` | `GET /v1/token/risk?chain=base\|bsc&address=0x…` | $0.01 |
| `token_risk_batch` | `POST /v1/token/risk/batch`，`{"chain":"base","addresses":[…]}` 或 `{"tokens":[{"chain","address"}…]}`，最多 10 个 | $0.05 |
| `btc_radar_latest` | `GET /v1/btc/radar/latest` | $0.01 |
| `project_info` | `GET /v1/project/:slug` | $0.05 |

参数错误（400）、未知项目（404）、无数据（503）都在付款前返回，不扣钱。

## 环境变量（在 MCP 服务器进程里设置）

| 变量 | 必填 | 说明 |
|---|---|---|
| `X402_PRIVATE_KEY` | 付费工具需要 | **你自己的** Base 钱包私钥（`0x` + 64 位十六进制）。钱包里放少量 USDC 即可，签的是 EIP-3009 授权，**不需要 ETH**。建议专门开一个小额钱包。 |
| `MAX_PAYMENT_USD` | 否 | 单次付款上限，默认 `0.05`，超过即拒付。 |
| `BTC_RADAR_API_URL` | 否 | 覆盖上游地址（仅测试用，必须 https）。 |

没配 `X402_PRIVATE_KEY` 时付费工具不会崩，而是返回 `payment_required`，附带真实报价（价格、收款地址、网络），并提示可改用任何 x402 客户端经 CDP Bazaar 直接调用。

## 安全校验（写死，不可配置）

每次收到 402 报价，签名前逐项检查，任何一项不符就**拒付**（`payment_refused`）：
- `payTo` 必须是 `0xabe2cccdafed6cec19e47a3794eeb487e646bc0f`
- 网络必须是 Base 主网 `eip155:8453`
- 资产必须是 Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- scheme 必须是 `exact`
- 金额 ≤ `MAX_PAYMENT_USD`

## 安装

### Cursor / 支持 Agent Plugins 的客户端
插件目录结构（Agent Plugins 1.0 标准）：
```
plugin.json                # 清单
mcp.json                   # stdio MCP 服务器：node ./dist/btc-radar-mcp.mjs
skills/btc-radar/SKILL.md  # 何时调用、价格、规则
dist/btc-radar-mcp.mjs     # 打包好的单文件服务器（无需 npm install）
```
需要 Node.js ≥ 20。私钥通过启动客户端的环境变量传入（不要写进 mcp.json）。

### 手动加到 MCP 配置（任意客户端）
```json
{
  "mcpServers": {
    "x402-btc-radar": {
      "command": "node",
      "args": ["/绝对路径/x402-btc-radar-plugin/dist/btc-radar-mcp.mjs"],
      "env": { "X402_PRIVATE_KEY": "${env:X402_PRIVATE_KEY}", "MAX_PAYMENT_USD": "0.05" }
    }
  }
}
```
（发布到 npm 后可改为 `"command": "npx", "args": ["-y", "x402-btc-radar-mcp"]`。）

## 开发

```bash
npm install
npm run typecheck
npm test          # 报价校验 + 模拟 402 流程（一次性随机私钥、mock 服务器，不花钱）
npm run build     # esbuild 打包到 dist/btc-radar-mcp.mjs
npm run smoke     # 真 stdio：initialize / tools/list / health(主网) / 无私钥调付费工具
```

## English (short)
MCP server + skill for a pay-per-call x402 API on Base mainnet (USDC). Tools: `health` (free), `token_risk` ($0.01), `token_risk_batch` ($0.05, ≤10 tokens), `btc_radar_latest` ($0.01), `project_info` ($0.05). Set `X402_PRIVATE_KEY` (your own wallet, USDC only, no ETH) to enable payments; `MAX_PAYMENT_USD` caps each payment (default 0.05). Quotes with an unexpected payee, network or asset are refused. Not investment advice.

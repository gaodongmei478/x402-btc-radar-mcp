import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BASE_MAINNET_CAIP2, BASE_USDC, ENV, EXPECTED_PAY_TO, PRICES, parseMaxPaymentUsd, resolveUpstream,
} from "./config.js";
import { callUpstream, type CallOptions, type CallResult } from "./upstream.js";

const VERSION = "0.1.0";
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x + 40 hex chars");
const CHAIN = z.enum(["base", "bsc"]);
const BAZAAR_HINT =
  "Also listed in the Coinbase CDP x402 Bazaar (search 'Token Risk & Honeypot Check' / 'BTC Ecosystem Radar') — any x402 client can pay it directly.";

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (obj: unknown, isError = false): ToolText => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

function settings() {
  return {
    baseUrl: resolveUpstream(process.env[ENV.upstream]),
    maxUsd: parseMaxPaymentUsd(process.env[ENV.maxPayment]),
    privateKey: process.env[ENV.privateKey]?.trim() || undefined,
  };
}

function render(r: CallResult, priceUsd: number): ToolText {
  switch (r.kind) {
    case "ok":
      return text(r.paid ? { paid: r.paid, data: r.data } : r.data);
    case "http_error":
      return text({ error: `upstream HTTP ${r.status} (no payment was made)`, upstream: r.data }, true);
    case "payment_needed_no_key": {
      const b = r.quote.best!;
      return text({
        error: "payment_required",
        message:
          `This tool costs $${b.amountUsd} USDC on Base mainnet (x402). No wallet is configured, so nothing was paid. ` +
          `Set ${ENV.privateKey} (a 0x-prefixed private key of YOUR OWN Base wallet holding a little USDC; no ETH needed) ` +
          `in the MCP server environment and retry. Per-call spend cap: ${ENV.maxPayment} (default 0.05). ${BAZAAR_HINT}`,
        quote: {
          price_usd: b.amountUsd, amount_atomic: String(b.amountAtomic), asset: BASE_USDC,
          network: BASE_MAINNET_CAIP2, pay_to: EXPECTED_PAY_TO, scheme: "exact", resource: r.resource,
        },
        documented_price_usd: priceUsd,
      }, true);
    }
    case "payment_refused":
      return text({
        error: "payment_refused",
        message: "The 402 quote failed this plugin's safety checks, so nothing was paid.",
        rejected_options: r.quote.rejected.map((v) => ({ reasons: v.reasons, option: v.requirement })),
        hint: `Raise ${ENV.maxPayment} only if the price is legitimately above your cap.`,
      }, true);
    case "payment_failed":
      return text({ error: "payment_failed", status: r.status, detail: r.detail, upstream: r.data }, true);
  }
}

async function run(opts: Omit<CallOptions, "baseUrl" | "maxUsd" | "privateKey">): Promise<ToolText> {
  try {
    const s = settings();
    return render(await callUpstream({ ...opts, ...s }), opts.priceUsd);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return text({ error: "plugin_error", message: msg.replace(/0x[0-9a-fA-F]{64}/g, "0x…redacted") }, true);
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "x402-btc-radar", version: VERSION });

  server.registerTool("health", {
    title: "BTC Radar API health (free)",
    description: "FREE. Checks the upstream x402 API (network, mainnet flag, whether radar data is loaded). No payment.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => run({ method: "GET", path: "/health", priceUsd: PRICES.health }));

  server.registerTool("token_risk", {
    title: "Token risk / honeypot check ($0.01)",
    description:
      "PAID $0.01 USDC on Base via x402 (paid from the caller's own wallet). Pre-trade safety check for one Base or BSC token: " +
      "honeypot buy/sell simulation, buy/sell tax, mint/pause/blacklist/proxy/owner flags, holder concentration, liquidity, pool age. " +
      "Returns verdict low|medium|high|honeypot, 0-100 score, action and reasons. Invalid input returns 400 and is not charged. Not investment advice.",
    inputSchema: { chain: CHAIN.describe("base (8453) or bsc (56)"), address: ADDR.describe("token contract address") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ chain, address }) =>
    run({ method: "GET", path: "/v1/token/risk", query: { chain, address }, priceUsd: PRICES.token_risk }));

  server.registerTool("token_risk_batch", {
    title: "Batch token risk check ($0.05)",
    description:
      "PAID $0.05 USDC per call (up to 10 tokens) on Base via x402, from the caller's own wallet. Same checks as token_risk. " +
      "Pass either chain+addresses (single chain) or tokens[] (mixed chains). If no token can be checked you are not charged. Not investment advice.",
    inputSchema: {
      chain: CHAIN.optional().describe("chain for addresses[]"),
      addresses: z.array(ADDR).min(1).max(10).optional(),
      tokens: z.array(z.object({ chain: CHAIN, address: ADDR })).min(1).max(10).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ chain, addresses, tokens }) => {
    if (!tokens && !(chain && addresses)) {
      return text({ error: "invalid_input", message: "Provide chain + addresses[] or tokens[] (max 10). Nothing was paid." }, true);
    }
    const body = tokens ? { tokens } : { chain, addresses };
    return run({ method: "POST", path: "/v1/token/risk/batch", body, priceUsd: PRICES.token_risk_batch });
  });

  server.registerTool("btc_radar_latest", {
    title: "Bitcoin new-project radar ($0.01)",
    description:
      "PAID $0.01 USDC on Base via x402, from the caller's own wallet. Latest list of newly launched Bitcoin L1 tokens/inscriptions " +
      "(BRC-20, Runes, Alkanes, Stamps) with stage, verdict, risk flags and sources. If no data is published the API returns 503 before payment. Not investment advice.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => run({ method: "GET", path: "/v1/btc/radar/latest", priceUsd: PRICES.btc_radar_latest }));

  server.registerTool("project_info", {
    title: "Single BTC project deep-dive ($0.05)",
    description:
      "PAID $0.05 USDC on Base via x402, from the caller's own wallet. Structured analysis of one radar project by slug " +
      "(what it is, entry, signature needs, risks, verdict). Use slugs from btc_radar_latest. Unknown slug returns 404 before payment. Not investment advice.",
    inputSchema: { slug: z.string().regex(/^[a-z0-9-]{1,64}$/, "lowercase letters, digits, hyphens").describe("project slug, e.g. gpda") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ slug }) =>
    run({ method: "GET", path: `/v1/project/${encodeURIComponent(slug)}`, priceUsd: PRICES.project_info }));

  return server;
}

async function main() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

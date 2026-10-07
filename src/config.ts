/**
 * Locked facts about the upstream paid API. Do NOT make payTo / network / asset
 * configurable: a plugin that can be pointed at another recipient is a phishing vector.
 */
export const UPSTREAM_DEFAULT = "https://x402-btc-radar.jinli-x402.workers.dev";

/** Owner's x402 receiving address (lower-case compare). */
export const EXPECTED_PAY_TO = "0xabe2cccdafed6cec19e47a3794eeb487e646bc0f";
/** Base mainnet, CAIP-2 (v2) and legacy name (v1). */
export const BASE_MAINNET_CAIP2 = "eip155:8453";
export const BASE_MAINNET_ALIASES = new Set(["eip155:8453", "base"]);
/** Circle USDC on Base mainnet (6 decimals). */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_DECIMALS = 6;

export const DEFAULT_MAX_PAYMENT_USD = 0.05;

/** Documented prices (USD) per tool — verified against x402-api/src/index.ts. */
export const PRICES = {
  health: 0,
  token_risk: 0.01,
  token_risk_batch: 0.05,
  btc_radar_latest: 0.01,
  project_info: 0.05,
} as const;

export const ENV = {
  privateKey: "X402_PRIVATE_KEY",
  maxPayment: "MAX_PAYMENT_USD",
  upstream: "BTC_RADAR_API_URL",
} as const;

export function parseMaxPaymentUsd(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_PAYMENT_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_PAYMENT_USD;
  return n;
}

/** Only https URLs are accepted (http allowed for localhost dev). */
export function resolveUpstream(raw: string | undefined): string {
  const v = (raw ?? "").trim() || UPSTREAM_DEFAULT;
  const u = new URL(v);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new Error(`${ENV.upstream} must be https`);
  }
  return u.origin;
}

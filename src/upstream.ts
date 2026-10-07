import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_MAINNET_CAIP2, ENV, EXPECTED_PAY_TO } from "./config.js";
import { parsePaymentRequired, vetQuote, vetRequirement, type PaymentRequiredLike, type QuoteSummary } from "./quote.js";

export type CallOptions = {
  baseUrl: string;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  priceUsd: number;
  maxUsd: number;
  privateKey?: string;
  fetchImpl?: typeof fetch;
};

export type CallResult =
  | { kind: "ok"; status: number; data: unknown; paid: null | { amountUsd: number | null; transaction?: string; payer?: string; network?: string } }
  | { kind: "http_error"; status: number; data: unknown }
  | { kind: "payment_needed_no_key"; quote: QuoteSummary; resource: string }
  | { kind: "payment_refused"; quote: QuoteSummary; resource: string }
  | { kind: "payment_failed"; status: number; data: unknown; detail?: string };

function buildUrl(o: CallOptions): string {
  const u = new URL(o.path, o.baseUrl);
  for (const [k, v] of Object.entries(o.query ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

async function readBody(res: Response): Promise<unknown> {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

function normalizeKey(k: string): `0x${string}` {
  const s = k.trim();
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${ENV.privateKey} is not a 32-byte hex private key`);
  return hex as `0x${string}`;
}

export async function callUpstream(o: CallOptions): Promise<CallResult> {
  const f = o.fetchImpl ?? fetch;
  const url = buildUrl(o);
  const init: RequestInit = { method: o.method, headers: { accept: "application/json" } };
  if (o.body !== undefined) {
    init.body = JSON.stringify(o.body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const first = await f(url, init);
  if (first.status !== 402) {
    const data = await readBody(first);
    return first.ok ? { kind: "ok", status: first.status, data, paid: null } : { kind: "http_error", status: first.status, data };
  }

  const body = await readBody(first);
  const pr = parsePaymentRequired(first.headers.get("payment-required"), body);
  if (!pr) return { kind: "payment_failed", status: 402, data: body, detail: "402 without a parseable PAYMENT-REQUIRED quote" };
  const quote = vetQuote(pr, o.maxUsd);
  if (!quote.best) return { kind: "payment_refused", quote, resource: url };
  if (!o.privateKey) return { kind: "payment_needed_no_key", quote, resource: url };

  // Pay with the CALLER's own key. Policy re-checks every option at signing time.
  const account = privateKeyToAccount(normalizeKey(o.privateKey));
  const client = new x402Client()
    .register(BASE_MAINNET_CAIP2, new ExactEvmScheme(account))
    .registerPolicy((_v, reqs) => reqs.filter((r) => vetRequirement(r as never, o.maxUsd).ok));
  const http = new x402HTTPClient(client);
  const payload = await http.createPaymentPayload(pr as never);
  const accepted = (payload as { accepted?: { payTo?: string } }).accepted;
  if (accepted && String(accepted.payTo).toLowerCase() !== EXPECTED_PAY_TO) {
    throw new Error("internal: signed payload payTo mismatch");
  }
  const headers = { ...(init.headers as Record<string, string>), ...http.encodePaymentSignatureHeader(payload) };
  const second = await f(url, { ...init, headers });
  const data = await readBody(second);
  if (!second.ok) {
    return { kind: second.status === 402 ? "payment_failed" : "http_error", status: second.status, data } as CallResult;
  }
  let settle: { transaction?: string; payer?: string; network?: string } = {};
  try { settle = http.getPaymentSettleResponse((n) => second.headers.get(n)) as typeof settle; } catch { /* optional */ }
  return {
    kind: "ok", status: second.status, data,
    paid: { amountUsd: quote.best.amountUsd, transaction: settle.transaction, payer: settle.payer, network: settle.network },
  };
}

export type { PaymentRequiredLike };

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";
import { parsePaymentRequired, vetQuote, vetRequirement } from "../src/quote.js";
import { callUpstream } from "../src/upstream.js";
import { EXPECTED_PAY_TO, parseMaxPaymentUsd } from "../src/config.js";

const REAL_HEADER = readFileSync(new URL("./fixtures/token-risk-402.header.txt", import.meta.url), "utf8").trim();
const real = parsePaymentRequired(REAL_HEADER, null)!;
const good = real.accepts![0];
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const quoteWith = (patch: Record<string, unknown>) => ({ ...real, accepts: [{ ...good, ...patch }] });

test("real mainnet 402 quote (captured) passes policy at $0.01", () => {
  assert.equal(real.x402Version, 2);
  const q = vetQuote(real, 0.05);
  assert.ok(q.best, JSON.stringify(q.rejected));
  assert.equal(q.best!.amountUsd, 0.01);
  assert.equal(q.best!.amountAtomic, 10000n);
});

test("payTo mismatch is refused (case-insensitive compare of correct one passes)", () => {
  assert.equal(vetRequirement({ ...good, payTo: EXPECTED_PAY_TO.toUpperCase().replace("0X", "0x") }, 0.05).ok, true);
  const v = vetRequirement({ ...good, payTo: "0x000000000000000000000000000000000000dEaD" }, 0.05);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(), /payTo must be/);
});

test("non-Base-mainnet network is refused; legacy v1 'base' accepted", () => {
  for (const n of ["eip155:84532", "base-sepolia", "eip155:1", "solana:mainnet", undefined]) {
    assert.equal(vetRequirement({ ...good, network: n as string }, 0.05).ok, false, String(n));
  }
  assert.equal(vetRequirement({ ...good, network: "base" }, 0.05).ok, true);
});

test("non-USDC asset or non-exact scheme is refused", () => {
  assert.equal(vetRequirement({ ...good, asset: "0x4200000000000000000000000000000000000006" }, 0.05).ok, false);
  assert.equal(vetRequirement({ ...good, scheme: "upto" }, 0.05).ok, false);
});

test("spend cap: default 0.05; 0.05 ok, 0.050001 refused; env override", () => {
  assert.equal(parseMaxPaymentUsd(undefined), 0.05);
  assert.equal(parseMaxPaymentUsd("abc"), 0.05);
  assert.equal(parseMaxPaymentUsd("-1"), 0.05);
  assert.equal(parseMaxPaymentUsd("0.2"), 0.2);
  assert.equal(vetRequirement({ ...good, amount: "50000" }, 0.05).ok, true);
  const over = vetRequirement({ ...good, amount: "50001" }, 0.05);
  assert.equal(over.ok, false);
  assert.match(over.reasons.join(), /exceeds MAX_PAYMENT_USD/);
  assert.equal(vetRequirement({ ...good, amount: "10000" }, 0.005).ok, false);
  assert.equal(vetRequirement({ ...good, amount: "abc" }, 0.05).ok, false);
});

test("best picks cheapest acceptable option and ignores bad ones", () => {
  const q = vetQuote({ accepts: [
    { ...good, payTo: "0x000000000000000000000000000000000000dEaD", amount: "1" },
    { ...good, amount: "20000" }, { ...good, amount: "10000" },
  ] }, 0.05);
  assert.equal(q.best!.amountAtomic, 10000n);
  assert.equal(q.rejected.length, 1);
});

// ---- callUpstream with a mocked fetch: no network, no real money ----
type Call = { url: string; headers: Record<string, string> };
function mockFetch(paymentRequired: unknown, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: String(input), headers });
    if (headers["payment-signature"] || headers["x-payment"]) {
      return new Response(JSON.stringify({ verdict: "low" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "payment_required" }), {
      status: 402, headers: { "content-type": "application/json", "payment-required": b64(paymentRequired) },
    });
  }) as typeof fetch;
}
const base = { baseUrl: "https://example.test", method: "GET" as const, path: "/v1/token/risk",
  query: { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, priceUsd: 0.01, maxUsd: 0.05 };

test("no key: returns payment_needed_no_key with parsed quote, sends no payment", async () => {
  const calls: Call[] = [];
  const r = await callUpstream({ ...base, fetchImpl: mockFetch(real, calls) });
  assert.equal(r.kind, "payment_needed_no_key");
  assert.equal(calls.length, 1);
});

test("with key but bad payTo / wrong network / over cap: refused, never signs", async () => {
  const key = generatePrivateKey(); // throwaway, unfunded, generated per test run
  for (const bad of [
    quoteWith({ payTo: "0x000000000000000000000000000000000000dEaD" }),
    quoteWith({ network: "eip155:84532" }),
    quoteWith({ amount: "60000" }),
  ]) {
    const calls: Call[] = [];
    const r = await callUpstream({ ...base, privateKey: key, fetchImpl: mockFetch(bad, calls) });
    assert.equal(r.kind, "payment_refused");
    assert.equal(calls.length, 1, "must not retry with a payment header");
  }
});

test("with throwaway key and valid quote: signs EIP-3009 for exact payTo/amount (mock server, no settlement)", async () => {
  const key = generatePrivateKey();
  const calls: Call[] = [];
  const r = await callUpstream({ ...base, privateKey: key, fetchImpl: mockFetch(real, calls) });
  assert.equal(r.kind, "ok");
  assert.equal(calls.length, 2);
  const sig = calls[1].headers["payment-signature"];
  assert.ok(sig, "PAYMENT-SIGNATURE header sent");
  const payload = JSON.parse(Buffer.from(sig, "base64").toString());
  assert.equal(payload.accepted.payTo.toLowerCase(), EXPECTED_PAY_TO);
  assert.equal(payload.accepted.network, "eip155:8453");
  assert.equal(payload.payload.authorization.to.toLowerCase(), EXPECTED_PAY_TO);
  assert.equal(payload.payload.authorization.value, "10000");
});

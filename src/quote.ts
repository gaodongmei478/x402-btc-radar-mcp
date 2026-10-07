import {
  BASE_MAINNET_ALIASES, BASE_USDC, EXPECTED_PAY_TO, USDC_DECIMALS,
} from "./config.js";

/** Subset of an x402 PaymentRequirements entry (v2 uses `amount`, v1 `maxAmountRequired`). */
export type Requirement = {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  [k: string]: unknown;
};
export type PaymentRequiredLike = {
  x402Version?: number;
  error?: string;
  resource?: { url?: string; description?: string } | string;
  accepts?: Requirement[];
  [k: string]: unknown;
};

export type Vetted = {
  ok: boolean;
  reasons: string[];
  amountAtomic: bigint | null;
  amountUsd: number | null;
  requirement: Requirement;
};

export type QuoteSummary = {
  acceptable: Vetted[];
  rejected: Vetted[];
  best: Vetted | null;
};

const lc = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

export function atomicToUsd(a: bigint): number {
  return Number(a) / 10 ** USDC_DECIMALS;
}

/** Check one payment option against the locked policy. Pure, no I/O. */
export function vetRequirement(r: Requirement, maxUsd: number): Vetted {
  const reasons: string[] = [];
  if (r.scheme !== "exact") reasons.push(`scheme must be "exact" (got ${String(r.scheme)})`);
  if (!BASE_MAINNET_ALIASES.has(String(r.network))) reasons.push(`network must be Base mainnet eip155:8453 (got ${String(r.network)})`);
  if (lc(r.asset) !== BASE_USDC) reasons.push(`asset must be Base USDC ${BASE_USDC} (got ${String(r.asset)})`);
  if (lc(r.payTo) !== EXPECTED_PAY_TO) reasons.push(`payTo must be ${EXPECTED_PAY_TO} (got ${String(r.payTo)})`);
  const raw = r.amount ?? r.maxAmountRequired;
  let amountAtomic: bigint | null = null;
  if (typeof raw === "string" && /^\d+$/.test(raw)) amountAtomic = BigInt(raw);
  else reasons.push(`amount missing or not an integer string (got ${String(raw)})`);
  let amountUsd: number | null = null;
  if (amountAtomic !== null) {
    amountUsd = atomicToUsd(amountAtomic);
    // Compare in atomic units to avoid float issues.
    const capAtomic = BigInt(Math.round(maxUsd * 10 ** USDC_DECIMALS));
    if (amountAtomic > capAtomic) reasons.push(`price $${amountUsd} exceeds MAX_PAYMENT_USD $${maxUsd}`);
    if (amountAtomic === 0n) reasons.push("zero amount");
  }
  return { ok: reasons.length === 0, reasons, amountAtomic, amountUsd, requirement: r };
}

export function vetQuote(pr: PaymentRequiredLike, maxUsd: number): QuoteSummary {
  const accepts = Array.isArray(pr.accepts) ? pr.accepts : [];
  const all = accepts.map((r) => vetRequirement(r, maxUsd));
  const acceptable = all.filter((v) => v.ok).sort((a, b) => (a.amountAtomic! < b.amountAtomic! ? -1 : 1));
  const rejected = all.filter((v) => !v.ok);
  return { acceptable, rejected, best: acceptable[0] ?? null };
}

/** Decode the base64 JSON PAYMENT-REQUIRED header (v2) or fall back to a v1 JSON body. */
export function parsePaymentRequired(headerValue: string | null, body: unknown): PaymentRequiredLike | null {
  if (headerValue) {
    try {
      return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as PaymentRequiredLike;
    } catch { /* fall through */ }
  }
  if (body && typeof body === "object" && Array.isArray((body as PaymentRequiredLike).accepts)) {
    return body as PaymentRequiredLike;
  }
  return null;
}

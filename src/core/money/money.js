/**
 * Exact BDT arithmetic in paisa (1 Taka = 100 paisa) using BigInt — no floating-point drift.
 * Amounts come in as strings or numbers ("4850000", 4850000.5, Prisma Decimal) and go out as
 * strings with 2 decimals ("4850000.00"), matching Decimal(14,2) columns.
 */

/** "4,850,000.5" / 4850000.5 / Decimal → 485000050n paisa. Throws on anything else. */
export function toPaisa(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Not an amount: "${value}"`);
  const [, minus, whole, fraction = ""] = match;
  const paisa = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minus ? -paisa : paisa;
}

/** 485000050n → "4850000.50" */
export function fromPaisa(paisa) {
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Rounds half away from zero: a / b for BigInts. */
export function divRound(a, b) {
  const q = a / b;
  const r = a % b;
  if (r === 0n) return q;
  const up = 2n * (r < 0n ? -r : r) >= (b < 0n ? -b : b);
  return up ? q + (a < 0n === b < 0n ? 1n : -1n) : q;
}

/** `percent` (up to 2 decimals, e.g. "12.5") of an amount in paisa, rounded to the paisa. */
export const percentOf = (paisa, percent) => divRound(paisa * toPaisa(percent), 10_000n);

/** Rounds to whole Taka. */
export const roundToTaka = (paisa) => divRound(paisa, 100n) * 100n;

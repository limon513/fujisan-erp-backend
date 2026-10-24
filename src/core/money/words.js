import { toPaisa } from "./money.js";

/** Amounts in words, the Bangladeshi way (crore, lakh, thousand), for money receipts. */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const belowHundred = (n) =>
  n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");

const belowThousand = (n) =>
  [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, belowHundred(n % 100)]
    .filter(Boolean)
    .join(" ");

/** 123456789n → "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine" */
export function numberInWords(value) {
  let n = BigInt(value);
  if (n === 0n) return "Zero";
  const parts = [];
  const crore = n / 10_000_000n;
  n %= 10_000_000n;
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  const lakh = Number(n / 100_000n);
  n %= 100_000n;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Number(n / 1_000n);
  n %= 1_000n;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(Number(n)));
  return parts.join(" ");
}

/** 935400.5 → "Taka Nine Lakh Thirty Five Thousand Four Hundred and Fifty Paisa Only" */
export function takaInWords(amount) {
  const paisa = toPaisa(amount);
  const taka = paisa / 100n;
  const rest = Number(paisa % 100n);
  return `Taka ${numberInWords(taka)}${rest ? ` and ${belowHundred(rest)} Paisa` : ""} Only`;
}

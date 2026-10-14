import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

const COST = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, COST);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Random password that satisfies the default policy (upper, lower, digit, symbol). */
export function generatePassword(length = 16) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const all = sets.join("");
  const pick = (chars) => chars[randomBytes(1)[0] % chars.length];
  const chars = [
    ...sets.map(pick),
    ...Array.from({ length: length - sets.length }, () => pick(all)),
  ];
  // Fisher–Yates shuffle so the required characters aren't always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

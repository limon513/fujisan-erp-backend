import { z } from "zod";

/** Default password policy: 8–128 chars with upper, lower and a digit. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

/**
 * Normalizes Bangladeshi mobile numbers to 8801XXXXXXXXX.
 * Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX with spaces/dashes. Returns null if invalid.
 */
export function normalizeBdMobile(value) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s\-()+]/g, "");
  const match = digits.match(/^(?:88)?(01[3-9]\d{8})$/);
  return match ? `88${match[1]}` : null;
}

export const bdMobileSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeBdMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Invalid Bangladeshi mobile number" });
      return z.NEVER;
    }
    return normalized;
  });

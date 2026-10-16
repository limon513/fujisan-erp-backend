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

/** Optional text: trims, turns "" into null (so clearing a field in a form stores null). */
export const optionalText = (max = 255) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

/** Optional UUID reference: "" → null. */
export const optionalId = () =>
  z.preprocess((value) => (value === "" ? null : value), z.uuid().nullable().optional());

/** Calendar date "YYYY-MM-DD" → Date at UTC midnight (for @db.Date columns). */
export const dateOnly = () => z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));

export const optionalDateOnly = () =>
  z.preprocess((value) => (value === "" ? null : value), dateOnly().nullable().optional());

/** Bangladesh NID: 10, 13 or 17 digits. */
export const nidSchema = z
  .string()
  .trim()
  .regex(/^(\d{10}|\d{13}|\d{17})$/, "NID must have 10, 13 or 17 digits");

/** Boolean from a query string ("true"/"false"). */
export const queryBoolean = () =>
  z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional();

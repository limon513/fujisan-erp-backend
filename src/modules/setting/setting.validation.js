import { z } from "zod";
import { optionalText } from "#core/utils/validators.js";

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

const updateCompany = z
  .object({
    name: z.string().trim().min(2).max(150).meta({ example: "Fujisan Properties Ltd." }),
    legalName: optionalText(200),
    address: optionalText(300),
    // Landline or mobile, stored as typed
    phone: blankToNull(
      z
        .string()
        .trim()
        .regex(/^[0-9+\-\s()]{6,20}$/, "Use digits, spaces, +, - or ()"),
    ),
    email: blankToNull(z.email().toLowerCase()),
    website: blankToNull(z.url()),
    tin: blankToNull(
      z
        .string()
        .trim()
        .regex(/^\d{12}$/, "e-TIN has 12 digits"),
    ),
    bin: blankToNull(
      z
        .string()
        .trim()
        .regex(/^[\d-]{9,15}$/, "Invalid BIN"),
    ),
    fiscalYearStartMonth: z
      .number()
      .int()
      .min(1)
      .max(12)
      .meta({ description: "1 = January … 7 = July (Bangladesh fiscal year)" }),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export const SettingValidation = { updateCompany };

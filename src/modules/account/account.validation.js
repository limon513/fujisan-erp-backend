import { z } from "zod";
import {
  optionalDateOnly,
  optionalId,
  optionalText,
  queryBoolean,
} from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });
const code = z
  .string()
  .trim()
  .regex(/^\d{3,8}$/, "3–8 digits")
  .meta({ example: "1122" });

const create = z.object({
  code,
  name: z.string().trim().min(2).max(120).meta({ example: "Dutch-Bangla Bank, Gulshan" }),
  parentId: optionalId().meta({
    description: "Group it belongs under; the type follows the parent",
  }),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]).optional().meta({
    description: "Only for a top-level account (no parent)",
  }),
  isGroup: z.boolean().default(false),
  description: optionalText(300),
});

const update = z
  .object({ code, name: create.shape.name, description: optionalText(300), isActive: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = z.object({
  balances: queryBoolean().meta({ description: "Include each account's balance" }),
  asOf: optionalDateOnly(),
  postable: queryBoolean().meta({
    description: "Only active non-group accounts (for entry forms)",
  }),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]).optional(),
});

const ledger = z.object({ from: optionalDateOnly(), to: optionalDateOnly() });

const trialBalance = z.object({ asOf: optionalDateOnly() });

export const AccountValidation = { idParams, create, update, list, ledger, trialBalance };

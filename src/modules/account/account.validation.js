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

/** Bank details, kept on bank accounts only. */
const bank = {
  isBank: z.boolean().optional().meta({ description: "Default: as its parent group" }),
  bankName: optionalText(120).meta({ example: "Eastern Bank PLC" }),
  bankBranch: optionalText(120).meta({ example: "Gulshan" }),
  accountTitle: optionalText(150).meta({ example: "Fujisan Properties Ltd." }),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9 -]{6,30}$/, "Digits only (6–30)")
    .optional()
    .or(z.literal("").transform(() => undefined))
    .nullable(),
  routingNumber: z
    .string()
    .trim()
    .regex(/^\d{9}$/, "A routing number has 9 digits")
    .optional()
    .or(z.literal("").transform(() => undefined))
    .nullable(),
  swiftCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "8 or 11 letters and digits")
    .optional()
    .or(z.literal("").transform(() => undefined))
    .nullable(),
};

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
  ...bank,
});

const update = z
  .object({
    code,
    name: create.shape.name,
    description: optionalText(300),
    isActive: z.boolean(),
    ...bank,
  })
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

const period = z.object({
  from: optionalDateOnly().meta({ description: "Default: start of the fiscal year of `to`" }),
  to: optionalDateOnly().meta({ description: "Default: today" }),
});

const cashBook = period.extend({
  accountId: z.uuid().optional().meta({ description: "One money account; default all of them" }),
});

export const AccountValidation = {
  idParams,
  create,
  update,
  list,
  ledger,
  trialBalance,
  period,
  cashBook,
};

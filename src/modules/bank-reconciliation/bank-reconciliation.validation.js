import { z } from "zod";
import { dateOnly, optionalText } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

/** Signed BDT with up to 2 decimals: + deposit, − withdrawal. */
const signedMoney = z.coerce
  .number({ error: "Enter an amount" })
  .refine((v) => v !== 0, { message: "Zero amount" })
  .refine((v) => Math.abs(v) <= 1_000_000_000_000, { message: "Too large" })
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "At most 2 decimals",
  });

const importStatement = z.object({
  accountId: z.uuid({ error: "Choose the bank account" }),
  fileName: optionalText(200),
  closingBalance: z.coerce
    .number({ error: "Enter the statement's closing balance" })
    .meta({ description: "Balance on the last day of the statement, as the bank shows it" }),
  lines: z
    .array(
      z.object({
        date: dateOnly(),
        description: z.string().trim().min(1).max(300),
        reference: optionalText(100),
        amount: signedMoney.meta({ description: "+ deposit, − withdrawal" }),
      }),
    )
    .min(1, "The statement has no lines")
    .max(5000),
});

const list = z.object({ accountId: z.uuid().optional() });

const match = z.object({ journalLineId: z.uuid() });

const ignore = z.object({ ignored: z.boolean().default(true) });

const book = z.object({
  accountId: z
    .uuid({ error: "Choose the account" })
    .meta({ description: "Other side, e.g. 5700 Bank and MFS charges or 4900 Other income" }),
  narration: optionalText(300),
});

export const BankReconciliationValidation = {
  idParams,
  importStatement,
  list,
  match,
  ignore,
  book,
};

import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";
import { dateOnly, money, optionalDateOnly, optionalText } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

const line = z.object({
  accountId: z.uuid({ error: "Choose an account" }),
  debit: money.default(0),
  credit: money.default(0),
  description: optionalText(200),
});

const create = z.object({
  date: dateOnly(),
  narration: z.string().trim().min(3, "Say what the entry is for").max(300),
  lines: z.array(line).min(2, "At least two lines").max(50),
});

const reverse = z.object({
  date: optionalDateOnly().meta({ description: "Date of the reversal; default today" }),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  search: z.string().trim().min(1).optional().meta({ description: "Entry number or narration" }),
  kind: z.enum(["MANUAL", "AUTO", "REVERSAL"]).optional(),
  accountId: z.uuid().optional(),
  from: optionalDateOnly(),
  to: optionalDateOnly(),
});

export const JournalValidation = { idParams, create, reverse, list };

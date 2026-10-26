import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";
import { dateOnly, money, optionalDateOnly, optionalText } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

const quote = z.object({ bookingId: z.uuid() });

const create = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().min(3, "Say why the booking is cancelled").max(500),
});

const refund = z
  .object({
    paidOn: optionalDateOnly().meta({ description: "Default today" }),
    method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "BKASH", "NAGAD"]),
    reference: optionalText(80),
    accountId: z
      .uuid()
      .optional()
      .meta({ description: "Cash / bank / mobile account paid from; default by method" }),
  })
  .refine((b) => b.method === "CASH" || b.reference, {
    message: "Enter the cheque number or transaction id",
    path: ["reference"],
  });

const schedule = z.object({
  parts: z
    .array(
      z.object({
        dueDate: dateOnly(),
        amount: money.refine((v) => v > 0, { message: "Enter an amount" }),
      }),
    )
    .min(1, "Add at least one part")
    .max(60)
    .meta({ description: "Unpaid parts; they must add up to the refund still to pay" }),
});

const withdraw = z.object({ reason: optionalText(300) });

const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "REFUNDED", "REJECTED", "WITHDRAWN"]).optional(),
  search: z.string().trim().min(1).optional(),
});

export const CancellationValidation = {
  idParams,
  quote,
  create,
  schedule,
  refund,
  withdraw,
  list,
};

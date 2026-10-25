import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { dateOnly, money, optionalDateOnly, optionalText } from "#core/utils/validators.js";
import { PAYMENT_METHODS, PAYMENT_STATUSES, sortableFields } from "./collection.constant.js";

const idParams = z.object({ id: z.uuid() });

const create = z
  .object({
    bookingId: z.uuid({ error: "Choose the booking" }),
    amount: money.refine((v) => v > 0, "Enter the amount").meta({ example: 155900 }),
    method: z.enum(PAYMENT_METHODS),
    reference: optionalText(80).meta({ description: "Transaction id, cheque number, ..." }),
    bankName: optionalText(80),
    chequeDate: optionalDateOnly(),
    paidOn: dateOnly()
      .optional()
      .meta({ description: "When the customer paid (YYYY-MM-DD); default today" }),
    note: optionalText(500),
  })
  .superRefine((body, ctx) => {
    if (body.method === "CHEQUE" && !body.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
    }
    if (["BKASH", "NAGAD", "BANK_TRANSFER"].includes(body.method) && !body.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the transaction id" });
    }
  });

const verify = z.object({
  depositAccountId: z.uuid().optional().meta({
    description: "Cash / bank / mobile account the money went into; default by payment method",
  }),
});

const reason = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    status: z.enum(PAYMENT_STATUSES).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    bookingId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    from: optionalDateOnly().meta({ description: "Paid on or after (YYYY-MM-DD)" }),
    to: optionalDateOnly().meta({ description: "Paid on or before (YYYY-MM-DD)" }),
  },
});

export const CollectionValidation = { idParams, create, verify, reason, list };

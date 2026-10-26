import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";
import { optionalDateOnly, optionalText } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

const quote = z.object({ bookingId: z.uuid() });

const create = z.object({
  bookingId: z.uuid(),
  toCustomerId: z.uuid().meta({ description: "The new owner (an existing customer)" }),
  reason: z.string().trim().min(3, "Say why the booking is transferred").max(500),
  agreementFileId: z
    .uuid({ error: "Upload the transfer agreement" })
    .meta({ description: "The signed transfer agreement, uploaded first via POST /files" }),
});

const agreement = z.object({
  fileId: z.uuid().meta({ description: "A new upload replacing the agreement" }),
});

const complete = z
  .object({
    paidOn: optionalDateOnly().meta({ description: "Day the fee was received; default today" }),
    method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "BKASH", "NAGAD"]),
    reference: optionalText(80),
    accountId: z
      .uuid()
      .optional()
      .meta({ description: "Cash / bank / mobile account received into; default by method" }),
  })
  .refine((b) => b.method === "CASH" || b.reference, {
    message: "Enter the cheque number or transaction id",
    path: ["reference"],
  });

const withdraw = z.object({ reason: optionalText(300) });

const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "COMPLETED", "REJECTED", "WITHDRAWN"]).optional(),
  search: z.string().trim().min(1).optional(),
});

export const TransferValidation = {
  idParams,
  quote,
  create,
  agreement,
  complete,
  withdraw,
  list,
};

import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "./collection.constant.js";
import { CollectionValidation as V } from "./collection.validation.js";

const tags = ["Finance: collections"];

const Payment = z
  .object({
    id: z.uuid(),
    paymentNo: z.string().meta({ example: "PAY-000001" }),
    receiptNo: z
      .string()
      .nullable()
      .meta({ example: "MR-000001", description: "Issued at verification" }),
    amount: z.string(),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().nullable(),
    paidOn: z.iso.datetime(),
    status: z.enum(PAYMENT_STATUSES),
    createdAt: z.iso.datetime(),
    booking: z.record(z.string(), z.unknown()),
    customer: z.record(z.string(), z.unknown()),
    amountInWords: z
      .string()
      .optional()
      .meta({ example: "Taka One Lakh Fifty Five Thousand Nine Hundred Only" }),
    allocations: z
      .array(z.object({ amount: z.string(), installment: z.record(z.string(), z.unknown()) }))
      .optional()
      .meta({ description: "How the money was applied to the schedule" }),
  })
  .meta({ id: "Payment", description: "Detail fields are included on GET /collections/{id}" });

const scope =
  "Follows `collection.view` scope (a payment belongs to its booking's sales executive).";

defineRoute({
  method: "get",
  path: "/collections",
  tags,
  summary: "List payments",
  description: `${scope} \`meta.totalAmount\` sums the filtered payments.`,
  request: { query: V.list },
  response: Payment,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/collections/:id",
  tags,
  summary: "Payment with its money receipt details",
  request: { params: V.idParams },
  response: Payment,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/collections",
  tags,
  summary: "Enter a payment (waits for verification)",
  description:
    "Requires `collection.create`. Confirmed or registered bookings only; at most what is still owed, counting entries waiting for verification. Cheques and mobile/bank transfers need their reference.",
  request: { body: V.create },
  response: Payment,
  status: 201,
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "post",
  path: "/collections/:id/verify",
  tags,
  summary: "Verify: issue the money receipt, apply the amount and post it",
  description:
    "Requires `collection.verify`; not by whoever entered it (except Super Admin). Applied to the schedule oldest first (down payment, then installments with their late fees). Posts Dr deposit account / Cr Customer advance (Customer receivable once registered) and Late fee income.",
  request: { params: V.idParams, body: V.verify },
  response: Payment,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/collections/:id/reject",
  tags,
  summary: "Reject an entry (it never counted)",
  request: { params: V.idParams, body: V.reason },
  response: Payment,
  errors: [400, 401, 403, 404, 409],
});
defineRoute({
  method: "post",
  path: "/collections/:id/reverse",
  tags,
  summary: "Reverse a verified payment (e.g. bounced cheque)",
  description:
    "Requires `collection.reverse`. The money comes off exactly the installments it paid.",
  request: { params: V.idParams, body: V.reason },
  response: Payment,
  errors: [400, 401, 403, 404, 409],
});

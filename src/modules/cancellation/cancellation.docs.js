import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { CancellationValidation as V } from "./cancellation.validation.js";

const tags = ["Sales: cancellations"];
const Status = z.enum(["PENDING_APPROVAL", "APPROVED", "REFUNDED", "REJECTED", "WITHDRAWN"]);

const Cancellation = z
  .object({
    id: z.uuid(),
    cancellationNo: z.string().meta({ example: "CN-000001" }),
    reason: z.string(),
    requestedOn: z.iso.datetime(),
    totalPaid: z.string().meta({ description: "Installment money paid (late fees excluded)" }),
    chargeAmount: z.string(),
    refundAmount: z.string(),
    policy: z.record(z.string(), z.unknown()),
    status: Status,
    refundParts: z.array(z.record(z.string(), z.unknown())),
    refundPaid: z.string(),
    refundDue: z.string(),
    nextRefund: z.record(z.string(), z.unknown()).nullable(),
    booking: z.record(z.string(), z.unknown()),
    journal: z
      .array(z.object({ id: z.uuid(), entryNo: z.string(), sourceType: z.string() }))
      .optional(),
  })
  .meta({ id: "Cancellation" });

const scope = "Follows `cancellation.view` scope (by the booking's sales executive).";

defineRoute({
  method: "get",
  path: "/cancellations",
  tags,
  summary: "Cancellations, newest first",
  description: scope,
  request: { query: V.list },
  response: Cancellation,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/cancellations/quote",
  tags,
  summary: "What cancelling a booking would refund",
  description:
    "Paid so far (installments, late fees excluded) minus the plan's cancellation charge. Confirmed bookings without payments waiting for verification.",
  request: { query: V.quote },
  response: z.object({
    bookingNo: z.string(),
    totalPaid: z.string(),
    chargeAmount: z.string(),
    refundAmount: z.string(),
    policy: z.record(z.string(), z.unknown()),
  }),
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "get",
  path: "/cancellations/:id",
  tags,
  summary: "One cancellation with its journal entries",
  request: { params: V.idParams },
  response: Cancellation,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/cancellations",
  tags,
  summary: "Ask to cancel a booking",
  description:
    "Requires `cancellation.create`. Sends a CANCELLATION approval (the approver may change the refund). Approval cancels the booking, writes off unpaid installments, frees the plot and posts Dr Customer advance / Cr Cancellation charge income + Cr Customer refunds payable. No payments can be taken while it is pending.",
  request: { body: V.create },
  response: Cancellation,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "put",
  path: "/cancellations/:id/refund-schedule",
  tags,
  summary: "Plan the refund in parts",
  description:
    "Requires `cancellation.refund`. Replaces the unpaid parts; they must add up to the refund still to pay. Paid parts stay.",
  request: { params: V.idParams, body: V.schedule },
  response: Cancellation,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/cancellations/:id/refund",
  tags,
  summary: "Pay out the next refund part",
  description:
    "Requires `cancellation.refund`. Pays the next due part (the whole refund when no schedule was set) and posts Dr Customer refunds payable / Cr the cash or bank account. The last part marks the cancellation REFUNDED.",
  request: { params: V.idParams, body: V.refund },
  response: Cancellation,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/cancellations/:id/withdraw",
  tags,
  summary: "Withdraw a cancellation waiting for approval",
  request: { params: V.idParams, body: V.withdraw },
  response: Cancellation,
  errors: [400, 401, 403, 404, 409],
});

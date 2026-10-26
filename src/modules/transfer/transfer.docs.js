import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { TransferValidation as V } from "./transfer.validation.js";

const tags = ["Sales: ownership transfers"];
const Status = z.enum(["PENDING_APPROVAL", "APPROVED", "COMPLETED", "REJECTED", "WITHDRAWN"]);

const Transfer = z
  .object({
    id: z.uuid(),
    transferNo: z.string().meta({ example: "TR-000001" }),
    reason: z.string(),
    requestedOn: z.iso.datetime(),
    feeAmount: z.string(),
    feePolicy: z.record(z.string(), z.unknown()),
    amountPaid: z
      .string()
      .nullable()
      .meta({ description: "Installment money that moves to the new customer" }),
    status: Status,
    agreement: z.record(z.string(), z.unknown()).nullable().optional(),
    fromCustomer: z.record(z.string(), z.unknown()),
    toCustomer: z.record(z.string(), z.unknown()),
    booking: z.record(z.string(), z.unknown()),
    journal: z
      .array(z.object({ id: z.uuid(), entryNo: z.string(), sourceType: z.string() }))
      .optional(),
  })
  .meta({ id: "OwnershipTransfer" });

const scope = "Follows `transfer.view` scope (by the booking's sales executive).";

defineRoute({
  method: "get",
  path: "/transfers",
  tags,
  summary: "Ownership transfers, newest first",
  description: scope,
  request: { query: V.list },
  response: Transfer,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/transfers/quote",
  tags,
  summary: "The fee for transferring a booking",
  description:
    "The plan's transfer fee (fixed, or a percentage of the net price) and what has been paid. Confirmed bookings without payments waiting for verification.",
  request: { query: V.quote },
  response: z.object({
    bookingNo: z.string(),
    amountPaid: z.string(),
    feeAmount: z.string(),
    feePolicy: z.record(z.string(), z.unknown()),
  }),
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "get",
  path: "/transfers/:id",
  tags,
  summary: "One transfer with its journal entry",
  request: { params: V.idParams },
  response: Transfer,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/transfers",
  tags,
  summary: "Ask to transfer a booking to another customer",
  description:
    "Requires `transfer.create` and the signed transfer agreement (upload it first with `POST /files`, category AGREEMENT). Sends an OWNERSHIP_TRANSFER approval (the approver may change the fee). With no fee the booking changes hands on approval; otherwise once accounts record the fee.",
  request: { body: V.create },
  response: Transfer,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "put",
  path: "/transfers/:id/agreement",
  tags,
  summary: "Replace the transfer agreement while waiting for approval",
  request: { params: V.idParams, body: V.agreement },
  response: Transfer,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/transfers/:id/complete",
  tags,
  summary: "Record the transfer fee and hand the booking over",
  description:
    "Requires `transfer.complete`. Posts Dr Customer advance (old customer) / Cr Customer advance (new customer) for what was paid, and Dr cash or bank / Cr Ownership transfer fee income.",
  request: { params: V.idParams, body: V.complete },
  response: Transfer,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/transfers/:id/withdraw",
  tags,
  summary: "Withdraw a transfer waiting for approval",
  request: { params: V.idParams, body: V.withdraw },
  response: Transfer,
  errors: [400, 401, 403, 404, 409],
});

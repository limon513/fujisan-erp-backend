import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { EmiValidation as V } from "./emi.validation.js";

const tags = ["Finance: EMI"];

const Installment = z
  .object({
    id: z.uuid(),
    number: z.number().int().meta({ description: "0 = down payment" }),
    kind: z.enum(["DOWN_PAYMENT", "INSTALLMENT"]),
    dueDate: z.iso.datetime(),
    amount: z.string(),
    lateFee: z.string(),
    paidAmount: z.string(),
    outstanding: z.string(),
    status: z.enum(["DUE", "PARTIAL", "PAID", "WAIVED"]),
    booking: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "Installment" });

const Totals = z.object({
  count: z.number().int(),
  amount: z.string(),
  bookings: z.number().int().optional(),
});

defineRoute({
  method: "get",
  path: "/installments",
  tags,
  summary: "Installments across bookings",
  description:
    "Confirmed and registered bookings inside `emi.view` scope (by the booking's sales executive). Overdue = past its due date and not fully paid; late fees apply after the plan's grace period.",
  request: { query: V.list },
  response: Installment,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/installments/summary",
  tags,
  summary: "Overdue, due this month, collected this month",
  response: z.object({ overdue: Totals, dueThisMonth: Totals, collectedThisMonth: Totals }),
});
defineRoute({
  method: "post",
  path: "/installments/:id/waive-late-fee",
  tags,
  summary: "Waive an installment's late fee",
  description: "Requires `emi.waive`. Any part of the fee already paid stays.",
  request: { params: V.idParams, body: V.waive },
  response: Installment,
  errors: [400, 401, 403, 404, 409],
});

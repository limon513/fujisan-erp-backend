import { z } from "zod";
import { defineCrudRoutes, defineRoute } from "#core/docs/openapi.js";
import { PaymentPlanValidation as V } from "./payment-plan.validation.js";

const tags = ["Sales: payment plans"];
const Charge = z.enum(["FIXED", "PERCENT"]);

const PaymentPlan = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    project: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int(),
    downPaymentType: Charge,
    downPaymentValue: z.string(),
    installmentCount: z.number().int(),
    frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
    interestRate: z.string(),
    gracePeriodDays: z.number().int(),
    lateFeeType: Charge,
    lateFeeValue: z.string(),
    cancellationChargeType: Charge,
    cancellationChargeValue: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "PaymentPlan" });

const Schedule = z
  .object({
    price: z.string(),
    downPayment: z.string(),
    financed: z.string(),
    interest: z.string(),
    totalPayable: z.string(),
    installmentAmount: z.string(),
    items: z.array(
      z.object({
        number: z.number().int(),
        kind: z.enum(["DOWN_PAYMENT", "INSTALLMENT"]),
        dueDate: z.iso.datetime(),
        amount: z.string(),
      }),
    ),
  })
  .meta({
    id: "PaymentSchedule",
    description:
      "Down payment on the start date; installments equal in whole Taka, the remainder on the last; the first one period after the start. Interest is flat per year on the financed amount.",
  });

defineCrudRoutes({
  base: "/payment-plans",
  tags,
  label: "payment plan",
  plural: "payment plans",
  permission: "payment-plan",
  validation: V,
  schema: PaymentPlan,
  deleteNote:
    "Soft delete; bookings keep their own copy of the terms. A plan with 0 installments must have a 100% down payment (full payment).",
});

defineRoute({
  method: "post",
  path: "/payment-plans/:id/schedule",
  tags,
  summary: "Payment schedule of a plan for a price",
  request: { params: V.idParams, body: V.schedule },
  response: Schedule,
  errors: [400, 401, 403, 404, 422],
});

defineRoute({
  method: "post",
  path: "/payment-plans/preview",
  tags,
  summary: "Payment schedule for unsaved terms (live preview)",
  description: "Requires `payment-plan.create` or `payment-plan.edit`.",
  request: { body: V.preview },
  response: Schedule,
  errors: [400, 401, 403, 422],
});

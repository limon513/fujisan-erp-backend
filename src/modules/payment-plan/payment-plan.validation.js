import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { dateOnly, money, optionalId, optionalText, queryBoolean } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });
const chargeType = z.enum(["FIXED", "PERCENT"]);
const percentOrAmount = money.meta({ description: "BDT if FIXED, 0–100 if PERCENT" });

// No .default() in shared fields: zod keeps defaults inside .partial()
const terms = {
  downPaymentType: chargeType,
  downPaymentValue: percentOrAmount,
  installmentCount: z.coerce.number().int().min(0).max(360),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  interestRate: money
    .max(100)
    .meta({ description: "Flat % per year on the amount after the down payment" }),
  gracePeriodDays: z.coerce.number().int().min(0).max(365),
  lateFeeType: chargeType,
  lateFeeValue: percentOrAmount,
  cancellationChargeType: chargeType,
  cancellationChargeValue: percentOrAmount,
};

const fields = {
  name: z.string().trim().min(2).max(80).meta({ example: "24 months, 20% down" }),
  description: optionalText(300),
  projectId: optionalId().meta({ description: "Empty = offered for every project" }),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  ...terms,
};

/** Rules across fields; `body` has every term (create, or update merged with the stored plan). */
export function termProblems(body) {
  const problems = [];
  for (const key of ["downPayment", "lateFee", "cancellationCharge"]) {
    if (body[`${key}Type`] === "PERCENT" && Number(body[`${key}Value`]) > 100) {
      problems.push({ path: `${key}Value`, message: "A percentage can't be over 100" });
    }
  }
  const full = body.downPaymentType === "PERCENT" && Number(body.downPaymentValue) === 100;
  if (Number(body.installmentCount) === 0 && !full) {
    problems.push({
      path: "installmentCount",
      message: "Without installments the down payment must be 100%",
    });
  }
  return problems;
}

const refineTerms = (body, ctx) => {
  for (const { path, message } of termProblems(body))
    ctx.addIssue({ code: "custom", path: [path], message });
};

const defaults = {
  downPaymentType: terms.downPaymentType.default("PERCENT"),
  frequency: terms.frequency.default("MONTHLY"),
  interestRate: terms.interestRate.default(0),
  gracePeriodDays: terms.gracePeriodDays.default(0),
  lateFeeType: terms.lateFeeType.default("FIXED"),
  lateFeeValue: terms.lateFeeValue.default(0),
  cancellationChargeType: terms.cancellationChargeType.default("PERCENT"),
  cancellationChargeValue: terms.cancellationChargeValue.default(0),
};

const create = z
  .object({
    ...fields,
    ...defaults,
    isActive: fields.isActive.default(true),
    sortOrder: fields.sortOrder.default(100),
  })
  .superRefine(refineTerms);

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const priceInput = {
  price: money.refine((v) => v > 0, "Enter a price").meta({ example: 4752000 }),
  startDate: dateOnly()
    .meta({ description: "Booking date (YYYY-MM-DD); default today" })
    .optional(),
};

const schedule = z.object(priceInput);
const preview = z.object({ ...terms, ...defaults, ...priceInput }).superRefine(refineTerms);

const list = listQuerySchema({
  sortable: ["sortOrder", "name", "createdAt"],
  filters: {
    isActive: queryBoolean(),
    projectId: z
      .uuid()
      .optional()
      .meta({ description: "Plans for this project, plus plans for all" }),
  },
});

export const PaymentPlanValidation = { idParams, create, update, schedule, preview, list };

import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { dateOnly, money, optionalId, optionalText } from "#core/utils/validators.js";
import { BOOKING_STATUSES, sortableFields } from "./booking.constant.js";

const idParams = z.object({ id: z.uuid() });

const terms = {
  customerId: z.uuid({ error: "Choose the customer" }),
  plotId: z.uuid({ error: "Choose the plot" }),
  paymentPlanId: z.uuid({ error: "Choose a payment plan" }),
  bookingDate: dateOnly().optional().meta({ description: "YYYY-MM-DD; default today" }),
  discountType: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
  discountValue: money.default(0).meta({ description: "BDT if FIXED, 0–100 if PERCENT" }),
};

const percentCap = (body, ctx) => {
  if (body.discountType === "PERCENT" && body.discountValue > 100) {
    ctx.addIssue({ code: "custom", path: ["discountValue"], message: "At most 100%" });
  }
};

const quote = z.object(terms).superRefine(percentCap);

const create = z
  .object({
    ...terms,
    discountReason: optionalText(500),
    leadId: optionalId().meta({ description: "The lead this booking comes from (moves it on)" }),
    notes: optionalText(1000),
  })
  .superRefine(percentCap)
  .superRefine((body, ctx) => {
    if (body.discountValue > 0 && !body.discountReason) {
      ctx.addIssue({
        code: "custom",
        path: ["discountReason"],
        message: "Say why the discount is needed",
      });
    }
  });

const withdraw = z.object({ reason: optionalText(300) });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    status: z.enum(BOOKING_STATUSES).optional(),
    projectId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    plotId: z.uuid().optional(),
  },
});

export const BookingValidation = { idParams, quote, create, withdraw, list };

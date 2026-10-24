import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";

const idParams = z.object({ id: z.uuid() });

const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  when: z.enum(["overdue", "month", "upcoming", "paid", "all"]).default("overdue").meta({
    description:
      "overdue = past due and unpaid; month = due from today to month end; upcoming = later",
  }),
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .meta({ description: "Customer name, booking no or plot code" }),
  projectId: z.uuid().optional(),
  bookingId: z.uuid().optional(),
});

const waive = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

export const EmiValidation = { idParams, list, waive };

import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";
import { optionalDateOnly } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

const period = z
  .object({
    from: optionalDateOnly().meta({ description: "Default: first day of this month" }),
    to: optionalDateOnly().meta({ description: "Default: today" }),
    projectId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });

const outstanding = z.object({
  projectId: z.uuid().optional(),
  overdueOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export const ReportValidation = { idParams, period, outstanding };

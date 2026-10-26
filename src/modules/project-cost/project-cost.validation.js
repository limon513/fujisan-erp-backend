import { z } from "zod";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";
import { money, optionalDateOnly, optionalText } from "#core/utils/validators.js";
import { CATEGORIES } from "./project-cost.constant.js";

const idParams = z.object({ id: z.uuid() });

const create = z.object({
  projectId: z.uuid(),
  date: optionalDateOnly().meta({ description: "Default today" }),
  category: z.enum(Object.keys(CATEGORIES)),
  description: z.string().trim().min(3, "Say what the cost is for").max(300),
  amount: money.refine((v) => v > 0, { message: "Enter an amount" }),
  paidFromAccountId: z
    .uuid({ error: "Choose the account it was paid from" })
    .meta({ description: "Cash / bank account, or a payable if not paid yet" }),
  reference: optionalText(80),
});

const reverse = z.object({
  reason: z.string().trim().min(3, "Say why it is reversed").max(300),
});

const list = z.object({
  projectId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

const summary = z.object({ projectId: z.uuid() });

export const ProjectCostValidation = { idParams, create, reverse, list, summary };

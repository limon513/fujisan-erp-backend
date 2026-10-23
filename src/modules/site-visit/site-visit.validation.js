import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, optionalText, queryBoolean } from "#core/utils/validators.js";
import {
  INTEREST_LEVELS,
  sortableFields,
  TRANSPORTS,
  VISIT_STATUSES,
  WHEN,
} from "./site-visit.constant.js";

const idParams = z.object({ id: z.uuid() });
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

// No .default() in shared fields: zod keeps defaults inside .partial()
const fields = {
  projectId: z.uuid({ error: "Choose a project" }),
  scheduledAt: instant.meta({ example: "2026-10-25T10:00:00+06:00" }),
  transport: z.enum(TRANSPORTS),
  pickupPoint: optionalText(200).meta({ example: "Uttara Sector 7, house 12" }),
  visitors: z.number().int().min(1).max(50),
  note: optionalText(1000),
  ownerId: optionalId().meta({
    description: "Employee going along. Default: the lead's assigned employee",
  }),
};

const create = z.object({
  leadId: z.uuid(),
  ...fields,
  transport: fields.transport.default("OFFICE_CAR"),
  visitors: fields.visitors.default(1),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const complete = z
  .object({
    status: z.enum(["VISITED", "NO_SHOW"]),
    visitedAt: instant.optional().meta({ description: "Default: now" }),
    interest: z.enum(INTEREST_LEVELS).optional(),
    plotsShown: optionalText(300).meta({ example: "A-5, A-7, B-2" }),
    feedback: optionalText(2000),
  })
  .refine((b) => b.status !== "VISITED" || b.interest, {
    message: "How interested were they?",
    path: ["interest"],
  });

const cancel = z.object({ reason: optionalText(300) });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    when: z.enum(WHEN).default("open"),
    status: z.enum(VISIT_STATUSES).optional(),
    projectId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    ownerId: z.uuid().optional(),
    mine: queryBoolean(),
  },
});

const counts = z.object({ mine: queryBoolean() });

export const SiteVisitValidation = { idParams, create, update, complete, cancel, list, counts };

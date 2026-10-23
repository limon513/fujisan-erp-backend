import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, optionalText, queryBoolean } from "#core/utils/validators.js";
import { FOLLOW_UP_TYPES, sortableFields, WHEN } from "./follow-up.constant.js";

const idParams = z.object({ id: z.uuid() });
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

// No .default() in shared fields: zod keeps defaults inside .partial()
const fields = {
  type: z.enum(FOLLOW_UP_TYPES),
  dueAt: instant.meta({ example: "2026-10-25T10:30:00+06:00" }),
  purpose: optionalText(300).meta({ example: "Send the Fujisan City brochure, ask about budget" }),
  ownerId: optionalId().meta({
    description: "Who should do it. Default: the lead's assigned employee",
  }),
};

const create = z.object({ leadId: z.uuid(), ...fields });

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const complete = z.object({
  outcome: z.string().trim().min(2, "Write what happened").max(2000),
  next: z
    .object({ type: z.enum(FOLLOW_UP_TYPES), dueAt: instant, purpose: optionalText(300) })
    .optional()
    .meta({ description: "Schedule the next follow-up in the same step" }),
});

const cancel = z.object({ reason: optionalText(300) });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    when: z.enum(WHEN).default("open"),
    leadId: z.uuid().optional(),
    ownerId: z.uuid().optional(),
    mine: queryBoolean().meta({ description: "Only follow-ups assigned to me" }),
  },
});

const counts = z.object({ mine: queryBoolean() });

export const FollowUpValidation = { idParams, create, update, complete, cancel, list, counts };

import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import {
  bdMobileSchema,
  money,
  optionalId,
  optionalText,
  queryBoolean,
} from "#core/utils/validators.js";
import { LEAD_STATUSES, MANUAL_ACTIVITIES, sortableFields } from "./lead.constant.js";

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

const idParams = z.object({ id: z.uuid() });

// No .default() in shared fields: zod keeps defaults inside .partial()
const fields = {
  fullName: z.string().trim().min(2).max(120).meta({ example: "Nasima Akter" }),
  mobile: bdMobileSchema.meta({ example: "01911000000" }),
  altMobile: blankToNull(bdMobileSchema),
  email: blankToNull(z.email().toLowerCase()),
  location: optionalText(120).meta({ example: "Uttara, Dhaka" }),
  profession: optionalText(80),
  budgetMin: blankToNull(money),
  budgetMax: blankToNull(money),
  preferredProjectId: optionalId(),
  propertyType: optionalText(40).meta({ example: "Residential plot" }),
  sourceId: z.uuid({ error: "Choose a source" }),
  campaignId: optionalId(),
  notes: optionalText(2000),
};

const budgetInOrder = (body) =>
  body.budgetMin == null || body.budgetMax == null || body.budgetMin <= body.budgetMax;
const budgetMessage = { message: "Lower than the minimum", path: ["budgetMax"] };

const create = z
  .object({
    ...fields,
    ownerId: optionalId().meta({
      description:
        "Assigned employee. Default: you. Assigning someone else needs `lead.assign`; leave empty with `unassigned: true` to put it in the pool.",
    }),
    unassigned: z.boolean().optional(),
    nextFollowUpAt: blankToNull(
      z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    ).meta({
      description: "Schedules a first follow-up call. Later ones: POST /follow-ups",
    }),
    confirmDuplicate: z
      .boolean()
      .optional()
      .meta({ description: "Create even if a lead with this mobile/email exists" }),
  })
  .refine(budgetInOrder, budgetMessage);

const update = z
  .object(fields)
  .partial()
  .extend({ confirmDuplicate: z.boolean().optional() })
  .refine((body) => Object.keys(body).some((k) => k !== "confirmDuplicate"), {
    message: "Nothing to update",
  })
  .refine(budgetInOrder, budgetMessage);

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    status: z
      .enum([...LEAD_STATUSES, "OPEN"])
      .optional()
      .meta({ description: "OPEN = every status except CONVERTED and LOST" }),
    sourceId: z.uuid().optional(),
    campaignId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    ownerId: z.uuid().optional(),
    unassigned: queryBoolean(),
  },
});

const pipeline = z.object({
  search: z.string().trim().min(1).optional(),
  sourceId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  unassigned: queryBoolean(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .meta({ description: "Leads per column" }),
});

const duplicateCheck = z
  .object({
    mobile: blankToNull(bdMobileSchema),
    email: blankToNull(z.email().toLowerCase()),
    excludeId: z.uuid().optional(),
  })
  .refine((q) => q.mobile || q.email, { message: "Give a mobile or email" });

const changeStatus = z
  .object({
    status: z.enum(LEAD_STATUSES.filter((s) => s !== "CONVERTED")).meta({
      description: "CONVERTED is set by POST /leads/{id}/convert",
    }),
    lostReason: optionalText(300),
    note: optionalText(1000),
  })
  .refine((b) => b.status !== "LOST" || b.lostReason, {
    message: "Say why the lead was lost",
    path: ["lostReason"],
  });

const addActivity = z.object({
  type: z.enum(MANUAL_ACTIVITIES),
  body: z.string().trim().min(2, "Write what happened").max(2000),
});

const assign = z.object({
  ownerId: z.uuid().nullable().meta({ description: "null puts the lead back in the pool" }),
  note: optionalText(500),
});

const convert = z.object({
  customerId: z.uuid().meta({ description: "The customer this lead became" }),
});

export const LeadValidation = {
  idParams,
  create,
  update,
  list,
  pipeline,
  duplicateCheck,
  changeStatus,
  addActivity,
  assign,
  convert,
};

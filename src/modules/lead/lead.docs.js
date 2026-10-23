import { z } from "zod";
import { defineCrudRoutes, defineRoute } from "#core/docs/openapi.js";
import { LEAD_STATUSES } from "./lead.constant.js";
import { LeadValidation as V } from "./lead.validation.js";

const tags = ["CRM: leads"];

const Ref = z.object({ id: z.uuid(), name: z.string() }).nullable();
const Status = z.enum(LEAD_STATUSES);

const Lead = z
  .object({
    id: z.uuid(),
    leadCode: z.string().meta({ example: "LD-000001" }),
    fullName: z.string(),
    mobile: z.string().meta({ example: "8801911000000" }),
    email: z.string().nullable(),
    location: z.string().nullable(),
    status: Status,
    budgetMin: z.string().nullable(),
    budgetMax: z.string().nullable(),
    nextFollowUpAt: z.iso.datetime().nullable(),
    lastActivityAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    source: Ref,
    campaign: Ref,
    preferredProject: Ref,
    owner: z
      .object({
        id: z.uuid(),
        fullName: z.string(),
        employeeCode: z.string(),
        team: Ref,
      })
      .nullable()
      .meta({ description: "null = unassigned (in the pool)" }),
    altMobile: z.string().nullable().optional(),
    profession: z.string().nullable().optional(),
    propertyType: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    lostReason: z.string().nullable().optional(),
    duplicateOf: z.record(z.string(), z.unknown()).nullable().optional(),
    duplicateCount: z.number().int().optional(),
    convertedCustomer: z.record(z.string(), z.unknown()).nullable().optional(),
    activities: z
      .array(
        z.object({
          id: z.uuid(),
          type: z.string(),
          body: z.string().nullable(),
          fromStatus: Status.nullable(),
          toStatus: Status.nullable(),
          createdAt: z.iso.datetime(),
          createdBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
        }),
      )
      .optional(),
  })
  .meta({ id: "Lead", description: "Detail fields are included on GET /leads/{id}" });

defineCrudRoutes({
  base: "/leads",
  tags,
  label: "lead",
  plural: "leads",
  permission: "lead",
  validation: V,
  schema: Lead,
  deleteNote:
    "Soft delete. Results follow your data scope (OWN = leads assigned to you, TEAM, DEPARTMENT, BRANCH, ALL). A lead whose mobile/email another lead has is refused unless confirmDuplicate is sent; it is then linked to the earlier lead.",
});

defineRoute({
  method: "get",
  path: "/leads/duplicates",
  tags,
  summary: "Leads and customers with this mobile or email",
  description: "Across all scopes, minimal details. Requires `lead.create` or `lead.edit`.",
  request: { query: V.duplicateCheck },
  response: z.object({
    leads: z.array(z.record(z.string(), z.unknown())),
    customers: z.array(z.record(z.string(), z.unknown())),
  }),
});

const actions = [
  [
    "status",
    "Move the lead along the pipeline",
    "Requires `lead.edit`. LOST needs `lostReason`. CONVERTED is set by /convert.",
    V.changeStatus,
  ],
  [
    "activities",
    "Log a call, note, message or meeting",
    "Requires `lead.edit`. The first contact moves a NEW lead to CONTACTED.",
    V.addActivity,
  ],
  [
    "assign",
    "Assign the lead to an employee, or back to the pool",
    "Requires `lead.assign`; the employee must be inside your scope. The employee is notified.",
    V.assign,
  ],
  [
    "convert",
    "Mark the lead as converted to a customer",
    "Requires `lead.edit`. Create the customer first (POST /customers), then link it here.",
    V.convert,
  ],
];
for (const [action, summary, description, body] of actions) {
  defineRoute({
    method: "post",
    path: `/leads/:id/${action}`,
    tags,
    summary,
    description,
    request: { params: V.idParams, body },
    response: Lead,
    errors: [400, 401, 403, 404, 409, 422],
  });
}

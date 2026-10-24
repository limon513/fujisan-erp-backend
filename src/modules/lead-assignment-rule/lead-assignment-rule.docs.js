import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { LeadAssignmentRuleValidation as V } from "./lead-assignment-rule.validation.js";

const tags = ["CRM: assignment rules"];
const base = "/lead-assignment-rules";
const Ref = z.object({ id: z.uuid(), name: z.string() }).nullable();

const Rule = z
  .object({
    id: z.uuid(),
    name: z.string(),
    priority: z.number().int(),
    isActive: z.boolean(),
    source: Ref,
    project: Ref,
    locationKeywords: z.array(z.string()),
    poolType: z.enum(["TEAM", "EMPLOYEES"]),
    team: Ref,
    pool: z
      .array(z.object({ id: z.uuid(), fullName: z.string() }))
      .meta({ description: "Active employees who get leads, in turn" }),
    assignedCount: z.number().int(),
    lastAssignedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "LeadAssignmentRule" });

const note =
  "Unassigned new leads are matched against active rules by priority (lowest first); the first rule whose set conditions all match hands the lead to the next person in its pool (round robin). No match: the lead stays in the pool.";

defineRoute({
  method: "get",
  path: base,
  tags,
  summary: "Assignment rules, in the order they are tried",
  description: note,
  response: z.array(Rule),
});
defineRoute({
  method: "post",
  path: `${base}/distribute`,
  tags,
  summary: "Run the rules over leads waiting in the pool",
  description: "Requires `lead-assignment-rule.edit`. Oldest first, up to 500.",
  response: z.object({ assigned: z.number().int(), left: z.number().int() }),
});
defineRoute({
  method: "get",
  path: `${base}/:id`,
  tags,
  summary: "One assignment rule",
  request: { params: V.idParams },
  response: Rule,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: base,
  tags,
  summary: "Create an assignment rule",
  description: note,
  request: { body: V.create },
  response: Rule,
  status: 201,
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "patch",
  path: `${base}/:id`,
  tags,
  summary: "Change an assignment rule",
  description: "Changing the pool restarts its round robin.",
  request: { params: V.idParams, body: V.update },
  response: Rule,
  errors: [400, 401, 403, 404, 422],
});
defineRoute({
  method: "delete",
  path: `${base}/:id`,
  tags,
  summary: "Delete an assignment rule",
  request: { params: V.idParams },
  errors: [401, 403, 404],
});

import { z } from "zod";
import { optionalId } from "#core/utils/validators.js";

const idParams = z.object({ id: z.uuid() });

// No .default() in shared fields: zod keeps defaults inside .partial()
const fields = {
  name: z.string().trim().min(2).max(80).meta({ example: "Facebook leads to Team Alpha" }),
  priority: z.number().int().min(0).max(1000).meta({ description: "Lower runs first" }),
  isActive: z.boolean(),
  sourceId: optionalId().meta({ description: "Only leads from this source" }),
  projectId: optionalId().meta({ description: "Only leads interested in this project" }),
  locationKeywords: z
    .array(z.string().trim().min(2).max(40))
    .max(20)
    .meta({ description: "Only leads whose location contains one of these", example: ["Uttara"] }),
  poolType: z.enum(["TEAM", "EMPLOYEES"]),
  teamId: optionalId(),
  employeeIds: z.array(z.uuid()).max(100),
};

const poolMatchesType = (body, ctx) => {
  if (body.poolType === "TEAM" && !body.teamId) {
    ctx.addIssue({ code: "custom", path: ["teamId"], message: "Choose a team" });
  }
  if (body.poolType === "EMPLOYEES" && !body.employeeIds?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["employeeIds"],
      message: "Choose at least one employee",
    });
  }
};

const create = z
  .object({
    ...fields,
    priority: fields.priority.default(100),
    isActive: fields.isActive.default(true),
    locationKeywords: fields.locationKeywords.default([]),
    employeeIds: fields.employeeIds.default([]),
  })
  .superRefine(poolMatchesType);

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export const LeadAssignmentRuleValidation = { idParams, create, update };

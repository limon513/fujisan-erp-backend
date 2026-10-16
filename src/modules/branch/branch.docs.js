import { z } from "zod";
import { defineCrudRoutes } from "#core/docs/openapi.js";
import { BranchValidation } from "./branch.validation.js";

const Branch = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    isHeadOffice: z.boolean(),
    isActive: z.boolean(),
    employeeCount: z.number().int(),
    teamCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Branch" });

defineCrudRoutes({
  base: "/branches",
  tags: ["Organization: Branches"],
  label: "branch",
  plural: "branches",
  permission: "branch",
  validation: BranchValidation,
  schema: Branch,
  deleteNote:
    "Only branches without employees or teams; otherwise deactivate. Only one branch can be the head office.",
});

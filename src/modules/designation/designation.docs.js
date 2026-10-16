import { z } from "zod";
import { defineCrudRoutes, RefSchema } from "#core/docs/openapi.js";
import { DesignationValidation } from "./designation.validation.js";

const Designation = z
  .object({
    id: z.uuid(),
    name: z.string(),
    level: z.number().int(),
    isActive: z.boolean(),
    department: RefSchema.nullable(),
    employeeCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Designation" });

defineCrudRoutes({
  base: "/designations",
  tags: ["Organization: Designations"],
  label: "designation",
  plural: "designations",
  permission: "designation",
  validation: DesignationValidation,
  schema: Designation,
  deleteNote: "Only designations no employee holds; otherwise deactivate.",
});

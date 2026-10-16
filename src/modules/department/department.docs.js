import { z } from "zod";
import { defineCrudRoutes } from "#core/docs/openapi.js";
import { DepartmentValidation } from "./department.validation.js";

const Department = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    head: z.object({ id: z.uuid(), fullName: z.string(), employeeCode: z.string() }).nullable(),
    employeeCount: z.number().int(),
    teamCount: z.number().int(),
    designationCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Department" });

defineCrudRoutes({
  base: "/departments",
  tags: ["Organization: Departments"],
  label: "department",
  plural: "departments",
  permission: "department",
  validation: DepartmentValidation,
  schema: Department,
  deleteNote: "Only unused departments; otherwise deactivate.",
});

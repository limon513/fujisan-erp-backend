import { z } from "zod";
import { defineCrudRoutes, RefSchema } from "#core/docs/openapi.js";
import {
  EmployeeValidation,
  EmploymentStatus,
  EmploymentType,
  Gender,
} from "./employee.validation.js";

const Employee = z
  .object({
    id: z.uuid(),
    employeeCode: z.string(),
    fullName: z.string(),
    photoFileId: z.uuid().nullable(),
    mobile: z.string().meta({ example: "8801711000000" }),
    email: z.string().nullable(),
    employmentType: EmploymentType,
    employmentStatus: EmploymentStatus,
    joiningDate: z.iso.datetime(),
    branch: RefSchema,
    department: RefSchema,
    designation: RefSchema,
    team: RefSchema.nullable(),
    reportingManager: z
      .object({ id: z.uuid(), fullName: z.string(), employeeCode: z.string() })
      .nullable(),
    user: z
      .object({ id: z.uuid(), username: z.string(), status: z.string(), role: RefSchema })
      .nullable()
      .meta({ description: "ERP login, if the employee has one" }),
    gender: Gender.nullable().optional(),
    dateOfBirth: z.iso.datetime().nullable().optional(),
    nidNumber: z.string().nullable().optional(),
    bloodGroup: z.string().nullable().optional(),
    presentAddress: z.string().nullable().optional(),
    permanentAddress: z.string().nullable().optional(),
    emergencyContact: z
      .object({ name: z.string(), relation: z.string(), mobile: z.string() })
      .nullable()
      .optional(),
    exitDate: z.iso.datetime().nullable().optional(),
    directReportCount: z.number().int().optional(),
  })
  .meta({ id: "Employee", description: "Detail fields are included on GET /employees/{id}" });

defineCrudRoutes({
  base: "/employees",
  tags: ["Organization: Employees"],
  label: "employee",
  plural: "employees",
  permission: "employee",
  validation: EmployeeValidation,
  schema: Employee,
  deleteNote:
    "Soft delete: hides the employee, disables their login and unlinks them as team leader, department head and reporting manager. Results are limited to your data scope (OWN = yourself, TEAM, DEPARTMENT, BRANCH, ALL).",
});

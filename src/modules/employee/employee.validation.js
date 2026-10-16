import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import {
  bdMobileSchema,
  dateOnly,
  nidSchema,
  optionalDateOnly,
  optionalId,
  optionalText,
  queryBoolean,
} from "#core/utils/validators.js";
import { sortableFields } from "./employee.constant.js";

export const Gender = z.enum(["MALE", "FEMALE", "OTHER"]);
export const EmploymentType = z.enum(["PERMANENT", "PROBATION", "CONTRACT", "INTERN"]);
export const EmploymentStatus = z.enum([
  "ACTIVE",
  "ON_LEAVE",
  "SUSPENDED",
  "RESIGNED",
  "TERMINATED",
]);
const BloodGroup = z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

const idParams = z.object({ id: z.uuid() });

const fields = {
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,30}$/, "2–30 letters, digits or dashes")
    .optional()
    .meta({ description: "Leave empty to auto-generate (EMP-0001)" }),
  fullName: z.string().trim().min(2).max(120).meta({ example: "Rahim Uddin" }),
  mobile: bdMobileSchema.meta({ example: "01711000000" }),
  email: blankToNull(z.email()),
  gender: blankToNull(Gender),
  dateOfBirth: optionalDateOnly(),
  nidNumber: blankToNull(nidSchema),
  bloodGroup: blankToNull(BloodGroup),
  presentAddress: optionalText(300),
  permanentAddress: optionalText(300),
  emergencyContact: z
    .object({
      name: z.string().trim().min(2).max(120),
      relation: z.string().trim().max(50),
      mobile: bdMobileSchema,
    })
    .nullable()
    .optional(),
  branchId: z.uuid(),
  departmentId: z.uuid(),
  designationId: z.uuid(),
  teamId: optionalId(),
  reportingManagerId: optionalId(),
  joiningDate: dateOnly().meta({ example: "2026-01-15" }),
  employmentType: EmploymentType,
  employmentStatus: EmploymentStatus,
  exitDate: optionalDateOnly(),
};

const create = z.object({
  ...fields,
  employmentType: fields.employmentType.default("PERMANENT"),
  employmentStatus: fields.employmentStatus.default("ACTIVE"),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    branchId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    designationId: z.uuid().optional(),
    teamId: z.uuid().optional(),
    employmentStatus: EmploymentStatus.optional(),
    hasAccount: queryBoolean().meta({
      description: "Only employees with (true) / without (false) an ERP login",
    }),
  },
});

export const EmployeeValidation = { idParams, create, update, list };

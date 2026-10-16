import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { bdMobileSchema, passwordSchema } from "#core/utils/validators.js";
import { sortableFields } from "./user.constant.js";

const idParams = z.object({ id: z.uuid() });

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/, "3–50 characters: letters, digits, dot, dash or underscore")
  .meta({ example: "rahim.uddin" });

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

const create = z.object({
  username,
  roleId: z.uuid(),
  employeeId: blankToNull(z.uuid()).meta({
    description: "Link the login to an employee (recommended)",
  }),
  email: blankToNull(z.email().toLowerCase()).meta({
    description: "Defaults to the employee's email",
  }),
  mobile: blankToNull(bdMobileSchema).meta({ description: "Defaults to the employee's mobile" }),
  password: passwordSchema
    .optional()
    .meta({ description: "Leave empty to generate a temporary password (returned once)" }),
  mustChangePassword: z.boolean().default(true),
});

const update = z
  .object({
    username,
    roleId: z.uuid(),
    email: blankToNull(z.email().toLowerCase()),
    mobile: blankToNull(bdMobileSchema),
    status: z
      .enum(["ACTIVE", "INACTIVE"])
      .meta({ description: "INACTIVE blocks sign-in and signs the user out" }),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    roleId: z.uuid().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).optional(),
  },
});

export const UserValidation = { idParams, create, update, list };

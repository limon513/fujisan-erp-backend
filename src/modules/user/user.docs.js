import { z } from "zod";
import { defineCrudRoutes, defineRoute, RefSchema } from "#core/docs/openapi.js";
import { UserValidation as V } from "./user.validation.js";

const tags = ["User Accounts"];

const User = z
  .object({
    id: z.uuid(),
    username: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]),
    isLocked: z.boolean(),
    mustChangePassword: z.boolean(),
    twoFactorEnabled: z.boolean(),
    lockedUntil: z.iso.datetime().nullable(),
    lastLoginAt: z.iso.datetime().nullable(),
    role: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), level: z.number().int() }),
    employee: z
      .object({
        id: z.uuid(),
        employeeCode: z.string(),
        fullName: z.string(),
        designation: RefSchema,
        branch: RefSchema,
      })
      .nullable(),
    temporaryPassword: z
      .string()
      .optional()
      .meta({ description: "Only on create without a password — shown once, give it to the user" }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "UserAccount" });

defineCrudRoutes({
  base: "/users",
  tags,
  label: "user account",
  plural: "user accounts",
  permission: "user",
  validation: V,
  schema: User,
  deleteNote:
    "Soft delete; the employee is unlinked so they can get a new login. You can only manage users whose role is below your level; the last active Super Admin can't be removed.",
});

defineRoute({
  method: "post",
  path: "/users/:id/reset-password",
  tags,
  summary: "Set a temporary password",
  description:
    "Requires `user.reset-password`. Returns a temporary password once, unlocks the account and signs the user out everywhere. They must change it at next sign-in.",
  request: { params: V.idParams },
  response: z.object({ temporaryPassword: z.string() }),
  errors: [401, 403, 404, 422],
});

defineRoute({
  method: "post",
  path: "/users/:id/unlock",
  tags,
  summary: "Unlock after failed sign-ins",
  description: "Requires `user.edit`.",
  request: { params: V.idParams },
  response: User,
  errors: [401, 403, 404],
});

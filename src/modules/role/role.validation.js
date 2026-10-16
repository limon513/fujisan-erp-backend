import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { MAX_CUSTOM_LEVEL, sortableFields } from "./role.constant.js";

const DataScope = z.enum(["OWN", "TEAM", "DEPARTMENT", "BRANCH", "ALL"]);

const idParams = z.object({ id: z.uuid() });

const fields = {
  name: z.string().trim().min(2).max(60).meta({ example: "Senior Sales Executive" }),
  description: z.string().trim().max(300).nullable().optional(),
  level: z
    .number()
    .int()
    .min(1)
    .max(MAX_CUSTOM_LEVEL)
    .meta({ description: "Seniority (1–99). You can only manage roles below your own level." }),
  require2FA: z.boolean(),
};

const create = z.object({
  ...fields,
  require2FA: fields.require2FA.default(false),
  copyFromRoleId: z
    .uuid()
    .optional()
    .meta({ description: "Start with the permissions of an existing role" }),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const setPermissions = z.object({
  permissions: z
    .array(z.object({ key: z.string().min(3).max(100), scope: DataScope }))
    .max(2000)
    .refine((list) => new Set(list.map((p) => p.key)).size === list.length, {
      message: "Each permission may appear only once",
    })
    .meta({
      description: "The complete set of permissions for the role (replaces the current set)",
    }),
});

const list = listQuerySchema({ sortable: sortableFields });

export const RoleValidation = { idParams, create, update, setPermissions, list, DataScope };

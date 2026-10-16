import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { RoleValidation as V } from "./role.validation.js";

const tags = ["Roles & Permissions"];
const base = "/roles";

const Role = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    level: z.number().int(),
    isSystem: z.boolean(),
    require2FA: z.boolean(),
    permissionsVersion: z.number().int(),
    userCount: z.number().int(),
    permissionCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Role" });

const RoleDetail = Role.extend({
  permissions: z.record(z.string(), V.DataScope).meta({ example: { "lead.view": "TEAM" } }),
}).meta({ id: "RoleDetail" });

const CatalogModule = z
  .object({
    module: z.string(),
    permissions: z.array(
      z.object({
        key: z.string(),
        module: z.string(),
        resource: z.string(),
        action: z.string(),
        label: z.string(),
        supportsScope: z.boolean(),
      }),
    ),
  })
  .meta({ id: "PermissionCatalogModule" });

const scopeNote =
  "Data scope: OWN → TEAM → DEPARTMENT → BRANCH → ALL. Unscoped permissions are stored as ALL.";

defineRoute({
  method: "get",
  path: base,
  tags,
  summary: "List roles",
  description: "Requires `role.view`.",
  request: { query: V.list },
  response: Role,
  paginated: true,
});
defineRoute({
  method: "get",
  path: `${base}/permission-catalog`,
  tags,
  summary: "All permissions grouped by module (permission matrix)",
  description: "Requires `role.view`.",
  response: z.array(CatalogModule),
  errors: [401, 403],
});
defineRoute({
  method: "get",
  path: `${base}/:id`,
  tags,
  summary: "Get a role with its permissions",
  description: "Requires `role.view`.",
  request: { params: V.idParams },
  response: RoleDetail,
  errors: [401, 403, 404],
});
defineRoute({
  method: "post",
  path: base,
  tags,
  summary: "Create a role",
  description:
    "Requires `role.create`. The level must be below your own. `copyFromRoleId` copies another role's permissions (only those you could grant yourself).",
  request: { body: V.create },
  response: RoleDetail,
  status: 201,
  errors: [400, 401, 403, 404, 409],
});
defineRoute({
  method: "patch",
  path: `${base}/:id`,
  tags,
  summary: "Update a role",
  description:
    "Requires `role.edit`. Only roles below your level. The slug never changes (code and seed refer to it).",
  request: { params: V.idParams, body: V.update },
  response: RoleDetail,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "put",
  path: `${base}/:id/permissions`,
  tags,
  summary: "Replace a role's permissions",
  description: `Requires \`role.edit\`. You can remove anything, but only add or widen permissions you hold yourself, with a scope no broader than yours. Users of the role get the change on their next request. ${scopeNote}`,
  request: { params: V.idParams, body: V.setPermissions },
  response: RoleDetail,
  errors: [400, 401, 403, 404, 422],
});
defineRoute({
  method: "delete",
  path: `${base}/:id`,
  tags,
  summary: "Delete a role",
  description:
    "Requires `role.delete`. System roles and roles still assigned to users can't be deleted.",
  request: { params: V.idParams },
  errors: [401, 403, 404, 409, 422],
});

import { definePermissions } from "#core/rbac/permissions.js";
import { RoleRoute } from "./role.route.js";
import "./role.docs.js";

export default {
  name: "role",
  basePath: "/roles",
  router: RoleRoute,
  core: true,
  permissions: definePermissions({
    module: "role",
    label: "Roles & Permissions",
    actions: ["view", "create", "edit", "delete"],
    scoped: false,
  }),
};

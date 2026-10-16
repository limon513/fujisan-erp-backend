import { definePermissions } from "#core/rbac/permissions.js";
import { UserRoute } from "./user.route.js";
import "./user.docs.js";

export default {
  name: "user",
  basePath: "/users",
  router: UserRoute,
  core: true,
  permissions: definePermissions({
    module: "user",
    label: "User accounts",
    actions: ["view", "create", "edit", "delete"],
    extra: [{ action: "reset-password", label: "Reset password / unlock" }],
    scoped: false,
  }),
};

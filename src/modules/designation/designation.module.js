import { definePermissions } from "#core/rbac/permissions.js";
import { DesignationRoute } from "./designation.route.js";
import "./designation.docs.js";

export default {
  name: "designation",
  basePath: "/designations",
  router: DesignationRoute,
  core: true,
  permissions: definePermissions({
    module: "designation",
    label: "Designations",
    actions: ["view", "create", "edit", "delete", "export"],
    scoped: false,
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { BranchRoute } from "./branch.route.js";
import "./branch.docs.js";

export default {
  name: "branch",
  basePath: "/branches",
  router: BranchRoute,
  core: true,
  permissions: definePermissions({
    module: "branch",
    label: "Branches",
    actions: ["view", "create", "edit", "delete", "export"],
    scoped: false,
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { ProjectCostRoute } from "./project-cost.route.js";
import "./project-cost.docs.js";

export default {
  name: "project-cost",
  basePath: "/project-costs",
  router: ProjectCostRoute,
  dependsOn: ["project", "account", "journal"],
  permissions: definePermissions({
    module: "finance",
    resource: "project-cost",
    label: "Project land and development costs",
    actions: ["view", "create", "export"],
    extra: [{ action: "reverse", label: "Reverse a recorded cost" }],
    scoped: false,
  }),
};

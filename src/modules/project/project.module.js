import { definePermissions } from "#core/rbac/permissions.js";
import { ProjectRoute } from "./project.route.js";
import "./project.docs.js";

export default {
  name: "project",
  basePath: "/projects",
  router: ProjectRoute,
  dependsOn: ["file"],
  permissions: definePermissions({
    module: "project",
    label: "Projects",
    actions: ["view", "create", "edit", "delete", "export"],
    scoped: false,
  }),
};

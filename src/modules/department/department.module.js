import { definePermissions } from "#core/rbac/permissions.js";
import { DepartmentRoute } from "./department.route.js";
import "./department.docs.js";

export default {
  name: "department",
  basePath: "/departments",
  router: DepartmentRoute,
  core: true,
  permissions: definePermissions({
    module: "department",
    label: "Departments",
    actions: ["view", "create", "edit", "delete", "export"],
    scoped: false,
  }),
};

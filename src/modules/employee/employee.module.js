import { definePermissions } from "#core/rbac/permissions.js";
import { EmployeeRoute } from "./employee.route.js";
import "./employee.docs.js";

export default {
  name: "employee",
  basePath: "/employees",
  router: EmployeeRoute,
  core: true,
  dependsOn: ["branch", "department", "designation", "team"],
  permissions: definePermissions({
    module: "employee",
    label: "Employees",
    actions: ["view", "create", "edit", "delete", "export"],
  }),
};

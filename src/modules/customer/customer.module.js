import { definePermissions } from "#core/rbac/permissions.js";
import { CustomerRoute } from "./customer.route.js";
import "./customer.docs.js";

export default {
  name: "customer",
  basePath: "/customers",
  router: CustomerRoute,
  dependsOn: ["file", "employee"],
  permissions: definePermissions({
    module: "customer",
    label: "Customers",
    actions: ["view", "create", "edit", "delete", "export"],
  }),
};

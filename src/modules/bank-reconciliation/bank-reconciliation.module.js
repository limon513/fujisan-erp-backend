import { definePermissions } from "#core/rbac/permissions.js";
import { BankReconciliationRoute } from "./bank-reconciliation.route.js";
import "./bank-reconciliation.docs.js";

export default {
  name: "bank-reconciliation",
  basePath: "/bank-reconciliation",
  router: BankReconciliationRoute,
  dependsOn: ["account", "journal"],
  permissions: definePermissions({
    module: "finance",
    resource: "bank-reconciliation",
    label: "Bank reconciliation",
    actions: ["view", "create", "edit", "delete"],
    scoped: false,
  }),
};

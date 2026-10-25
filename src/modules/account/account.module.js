import { definePermissions } from "#core/rbac/permissions.js";
import { AccountRoute } from "./account.route.js";
import "./account.docs.js";

export default {
  name: "account",
  basePath: "/accounts",
  router: AccountRoute,
  // Automatic postings (payments, registration) need the chart of accounts
  core: true,
  permissions: definePermissions({
    module: "finance",
    resource: "account",
    label: "Chart of accounts and reports",
    actions: ["view", "create", "edit", "delete", "export", "print"],
    scoped: false,
  }),
};

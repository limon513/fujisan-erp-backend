import { definePermissions } from "#core/rbac/permissions.js";
import { EmiRoute } from "./emi.route.js";
import "./emi.docs.js";

export default {
  name: "emi",
  basePath: "/installments",
  router: EmiRoute,
  dependsOn: ["booking"],
  permissions: definePermissions({
    module: "finance",
    resource: "emi",
    label: "EMI / installments",
    actions: ["view", "export", "print"],
    extra: [{ action: "waive", label: "Waive late fees" }],
  }),
};

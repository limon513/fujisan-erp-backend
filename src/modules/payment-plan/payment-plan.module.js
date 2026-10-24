import { definePermissions } from "#core/rbac/permissions.js";
import { PaymentPlanRoute } from "./payment-plan.route.js";
import "./payment-plan.docs.js";

export default {
  name: "payment-plan",
  basePath: "/payment-plans",
  router: PaymentPlanRoute,
  dependsOn: ["project"],
  permissions: definePermissions({
    module: "sales",
    resource: "payment-plan",
    label: "Payment plans",
    scoped: false,
  }),
};

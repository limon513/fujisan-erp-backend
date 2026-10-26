import { definePermissions } from "#core/rbac/permissions.js";
import { CancellationRoute } from "./cancellation.route.js";
import "./cancellation.docs.js";

export default {
  name: "cancellation",
  basePath: "/cancellations",
  router: CancellationRoute,
  dependsOn: ["booking", "collection", "journal"],
  permissions: definePermissions({
    module: "sales",
    resource: "cancellation",
    label: "Cancellations and refunds",
    actions: ["view", "create", "export", "print"],
    extra: [{ action: "refund", label: "Pay refunds" }],
  }),
  approvalWorkflows: [
    {
      code: "CANCELLATION",
      name: "Cancellation",
      description:
        "Cancels a confirmed booking and sets the refund. The approver may change the refund.",
      adjustableLabel: "Refund (৳)",
    },
  ],
};

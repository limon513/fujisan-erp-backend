import { definePermissions } from "#core/rbac/permissions.js";
import { TransferRoute } from "./transfer.route.js";
import "./transfer.docs.js";

export default {
  name: "transfer",
  basePath: "/transfers",
  router: TransferRoute,
  dependsOn: ["booking", "customer", "collection", "journal"],
  permissions: definePermissions({
    module: "sales",
    resource: "transfer",
    label: "Ownership transfers",
    actions: ["view", "create", "export", "print"],
    extra: [{ action: "complete", label: "Collect the fee and complete transfers" }],
  }),
  approvalWorkflows: [
    {
      code: "OWNERSHIP_TRANSFER",
      name: "Ownership transfer",
      description:
        "Moves a confirmed booking to another customer. The approver may change the transfer fee.",
      adjustableLabel: "Transfer fee (৳)",
    },
  ],
};

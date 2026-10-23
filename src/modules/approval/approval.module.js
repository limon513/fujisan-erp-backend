import { definePermissions } from "#core/rbac/permissions.js";
import { ApprovalRoute } from "./approval.route.js";
import "./approval.docs.js";

export default {
  name: "approval",
  basePath: "/approvals",
  router: ApprovalRoute,
  // Business modules (discount, booking, cancellation, ...) route their decisions through it
  core: true,
  permissions: [
    ...definePermissions({
      module: "approval",
      label: "Approval requests",
      actions: ["view"],
    }),
    ...definePermissions({
      module: "approval",
      resource: "approval-workflow",
      label: "Approval chains",
      actions: ["view", "edit"],
      scoped: false,
    }),
  ],
};

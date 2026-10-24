import { definePermissions } from "#core/rbac/permissions.js";
import { LeadAssignmentRuleRoute } from "./lead-assignment-rule.route.js";
import "./lead-assignment-rule.docs.js";

export default {
  name: "lead-assignment-rule",
  basePath: "/lead-assignment-rules",
  router: LeadAssignmentRuleRoute,
  dependsOn: ["lead"],
  permissions: definePermissions({
    module: "crm",
    resource: "lead-assignment-rule",
    label: "Lead assignment rules",
    scoped: false,
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { LeadRoute } from "./lead.route.js";
import "./lead.docs.js";

export default {
  name: "lead",
  basePath: "/leads",
  router: LeadRoute,
  dependsOn: ["lead-source", "campaign", "customer", "project"],
  permissions: definePermissions({
    module: "crm",
    resource: "lead",
    label: "Leads",
    actions: ["view", "create", "edit", "delete", "export"],
    extra: [{ action: "assign", label: "Assign to others" }],
  }),
};

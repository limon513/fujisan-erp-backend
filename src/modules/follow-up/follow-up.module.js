import { definePermissions } from "#core/rbac/permissions.js";
import { FollowUpRoute } from "./follow-up.route.js";
import "./follow-up.docs.js";

export default {
  name: "follow-up",
  basePath: "/follow-ups",
  router: FollowUpRoute,
  dependsOn: ["lead"],
  permissions: definePermissions({
    module: "crm",
    resource: "follow-up",
    label: "Follow-ups",
    actions: ["view", "create", "edit"],
  }),
};

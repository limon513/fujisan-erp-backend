import { definePermissions } from "#core/rbac/permissions.js";
import { LeadSourceRoute } from "./lead-source.route.js";
import "./lead-source.docs.js";

export default {
  name: "lead-source",
  basePath: "/lead-sources",
  router: LeadSourceRoute,
  permissions: definePermissions({
    module: "crm",
    resource: "lead-source",
    label: "Lead sources",
    scoped: false,
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { SiteVisitRoute } from "./site-visit.route.js";
import "./site-visit.docs.js";

export default {
  name: "site-visit",
  basePath: "/site-visits",
  router: SiteVisitRoute,
  dependsOn: ["lead", "project"],
  permissions: definePermissions({
    module: "crm",
    resource: "site-visit",
    label: "Site visits",
    actions: ["view", "create", "edit"],
  }),
};

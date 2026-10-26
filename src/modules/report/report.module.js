import { definePermissions } from "#core/rbac/permissions.js";
import { ReportRoute } from "./report.route.js";
import "./report.docs.js";

export default {
  name: "report",
  basePath: "/reports",
  router: ReportRoute,
  dependsOn: ["booking", "collection"],
  permissions: definePermissions({
    module: "report",
    resource: "report",
    label: "Sales and collection reports",
    actions: ["view", "export", "print"],
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { DashboardRoute } from "./dashboard.route.js";
import "./dashboard.docs.js";

export default {
  name: "dashboard",
  basePath: "/dashboard",
  router: DashboardRoute,
  core: true,
  permissions: definePermissions({
    module: "dashboard",
    label: "Dashboard",
    actions: ["view"],
    scoped: false,
  }),
};

import { definePermissions } from "#core/rbac/permissions.js";
import { PlotRoute } from "./plot.route.js";
import "./plot.docs.js";

export default {
  name: "plot",
  basePath: "/plots",
  router: PlotRoute,
  dependsOn: ["project"],
  permissions: definePermissions({
    module: "project",
    resource: "plot",
    label: "Plots",
    actions: ["view", "create", "edit", "delete", "export"],
    extra: [
      { action: "hold", label: "Hold / release" },
      { action: "block", label: "Block / unblock" },
      { action: "price", label: "Change price" },
    ],
    scoped: false,
  }),
};

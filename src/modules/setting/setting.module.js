import { definePermissions } from "#core/rbac/permissions.js";
import { SettingRoute } from "./setting.route.js";
import "./setting.docs.js";

export default {
  name: "setting",
  basePath: "/settings",
  router: SettingRoute,
  core: true,
  permissions: definePermissions({
    module: "setting",
    label: "Settings",
    actions: ["view", "edit"],
    scoped: false,
  }),
};

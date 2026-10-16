import { definePermissions } from "#core/rbac/permissions.js";
import { TeamRoute } from "./team.route.js";
import "./team.docs.js";

export default {
  name: "team",
  basePath: "/teams",
  router: TeamRoute,
  core: true,
  permissions: definePermissions({
    module: "team",
    label: "Teams",
    actions: ["view", "create", "edit", "delete", "export"],
    scoped: false,
  }),
};

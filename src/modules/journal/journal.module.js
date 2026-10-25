import { definePermissions } from "#core/rbac/permissions.js";
import { JournalRoute } from "./journal.route.js";
import "./journal.docs.js";

export default {
  name: "journal",
  basePath: "/journals",
  router: JournalRoute,
  core: true,
  dependsOn: ["account"],
  permissions: definePermissions({
    module: "finance",
    resource: "journal",
    label: "Journal entries",
    actions: ["view", "create", "export", "print"],
    extra: [{ action: "reverse", label: "Reverse manual entries" }],
    scoped: false,
  }),
};

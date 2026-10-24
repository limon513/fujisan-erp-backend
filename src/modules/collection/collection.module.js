import { definePermissions } from "#core/rbac/permissions.js";
import { CollectionRoute } from "./collection.route.js";
import "./collection.docs.js";

export default {
  name: "collection",
  basePath: "/collections",
  router: CollectionRoute,
  dependsOn: ["booking"],
  permissions: definePermissions({
    module: "finance",
    resource: "collection",
    label: "Collections",
    actions: ["view", "create", "export", "print"],
    extra: [
      { action: "verify", label: "Verify (issue money receipt) / reject" },
      { action: "reverse", label: "Reverse (bounced cheque, mistake)" },
    ],
  }),
};

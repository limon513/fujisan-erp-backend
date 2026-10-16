import { definePermissions } from "#core/rbac/permissions.js";
import { AuditLogRoute } from "./audit-log.route.js";
import "./audit-log.docs.js";

export default {
  name: "audit-log",
  basePath: "/audit-logs",
  router: AuditLogRoute,
  core: true,
  permissions: definePermissions({
    module: "audit-log",
    label: "Audit log",
    actions: ["view", "export"],
    scoped: false,
  }),
};

import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { AuditLogValidation as V } from "./audit-log.validation.js";

const tags = ["Audit Log"];

const Actor = z
  .object({ id: z.uuid(), username: z.string().nullable(), name: z.string() })
  .nullable()
  .meta({
    description: "null = system (seed, background job)",
  });

const AuditEntry = z
  .object({
    id: z.uuid(),
    action: z.string().meta({ example: "UPDATE" }),
    entityType: z.string().meta({ example: "Branch" }),
    entityId: z.string().nullable(),
    description: z.string().nullable().meta({ example: 'Updated Branch "Head Office"' }),
    changedFields: z.array(z.string()),
    ip: z.string().nullable(),
    createdAt: z.iso.datetime(),
    user: Actor,
  })
  .meta({ id: "AuditEntry" });

const AuditEntryDetail = AuditEntry.extend({
  oldValues: z.record(z.string(), z.unknown()).nullable(),
  newValues: z.record(z.string(), z.unknown()).nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
}).meta({ id: "AuditEntryDetail" });

defineRoute({
  method: "get",
  path: "/audit-logs",
  tags,
  summary: "Search the audit log",
  description:
    "Requires `audit-log.view`. Every create/update/delete on audited records plus business events (LOGIN, PASSWORD_CHANGED, PERMISSIONS_CHANGED, ...). Secrets are stored as `[redacted]`.",
  request: { query: V.list },
  response: AuditEntry,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/audit-logs/filter-options",
  tags,
  summary: "Record types and actions present in the log",
  response: z.object({ entityTypes: z.array(z.string()), actions: z.array(z.string()) }),
  errors: [401, 403],
});
defineRoute({
  method: "get",
  path: "/audit-logs/:id",
  tags,
  summary: "One audit entry with old and new values",
  request: { params: V.idParams },
  response: AuditEntryDetail,
  errors: [401, 403, 404],
});

import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { sortableFields } from "./audit-log.constant.js";

const idParams = z.object({ id: z.uuid() });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    userId: z.uuid().optional(),
    entityType: z.string().trim().max(50).optional(),
    entityId: z.string().trim().max(100).optional(),
    action: z.string().trim().max(50).optional(),
    from: z.iso
      .date()
      .optional()
      .meta({ description: "From date (inclusive, Asia/Dhaka)", example: "2026-10-01" }),
    to: z.iso
      .date()
      .optional()
      .meta({ description: "To date (inclusive, Asia/Dhaka)", example: "2026-10-31" }),
  },
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  path: ["to"],
  message: "Must be on or after 'from'",
});

export const AuditLogValidation = { idParams, list };

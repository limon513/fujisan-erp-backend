import { Prisma } from "#generated/prisma/client.ts";
import { getContext } from "#core/context/requestContext.js";
import logger from "#core/utils/logger.js";
import { ALWAYS_IGNORED, AUDITED_MODELS, REDACTED_FIELDS } from "./audit.config.js";

const lowerFirst = (name) => name[0].toLowerCase() + name.slice(1);

/** JSON-safe snapshot with secrets redacted (Decimal/Date/BigInt → strings). */
export function snapshot(record) {
  if (!record) return null;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (REDACTED_FIELDS.includes(key)) out[key] = "[redacted]";
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === "bigint" || Prisma.Decimal.isDecimal(value))
      out[key] = value.toString();
    else out[key] = value;
  }
  return out;
}

/** Changed fields between two snapshots, minus ignored ones. */
export function diff(before, after, ignored) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter(
    (key) =>
      !ignored.includes(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
  );
}

const pick = (record, keys) => Object.fromEntries(keys.map((key) => [key, record?.[key] ?? null]));

const VERB = { CREATE: "Created", UPDATE: "Updated", DELETE: "Deleted" };

/**
 * Prisma client extension that writes an AuditLog row for create/update/upsert/delete on
 * AUDITED_MODELS. Who/where comes from the request context (null user = system, e.g. seed).
 *
 * `base` is the un-extended client, used to read the "before" row and to write the log so the
 * extension never audits itself. Note: the log is written outside any surrounding interactive
 * transaction, so a rolled-back change can still leave an entry.
 */
export function auditExtension(base) {
  const write = async ({ model, action, entityId, before, after, changed }) => {
    const config = AUDITED_MODELS[model];
    const context = getContext();
    const label = (after ?? before)?.[config.label];
    try {
      await base.auditLog.create({
        data: {
          action,
          entityType: model,
          entityId: entityId ? String(entityId) : null,
          description: `${VERB[action]} ${model}${label ? ` "${label}"` : ""}`,
          oldValues: before ? (action === "UPDATE" ? pick(before, changed) : before) : undefined,
          newValues: after ? (action === "UPDATE" ? pick(after, changed) : after) : undefined,
          changedFields: changed,
          userId: context.userId ?? null,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
      });
    } catch (error) {
      logger.error({ err: error, model, action }, "Failed to write audit log");
    }
  };

  const findBefore = (model, where) => base[lowerFirst(model)].findUnique({ where });

  // Plain values written by a create/update (operations like { increment: 1 } are skipped)
  const scalarData = (data = {}) =>
    Object.fromEntries(
      Object.entries(data).filter(
        ([, value]) =>
          value === null ||
          typeof value !== "object" ||
          value instanceof Date ||
          Array.isArray(value) ||
          Prisma.Decimal.isDecimal(value),
      ),
    );

  /**
   * The row after the write. Read from the query result (it runs inside the caller's transaction,
   * unlike a separate read); when the caller narrowed it with select/include, fill in from the
   * previous row and the written data.
   */
  const afterRow = (args, result, before) =>
    snapshot(
      args.select || args.include
        ? { ...before, ...scalarData(args.data ?? args.update ?? args.create), ...result }
        : result,
    );

  const relationFree = (row, before) =>
    row && before ? Object.fromEntries(Object.entries(row).filter(([key]) => key in before)) : row;

  return Prisma.defineExtension({
    name: "audit",
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (AUDITED_MODELS[model]) {
            const after = afterRow(args, result, null);
            await write({
              model,
              action: "CREATE",
              entityId: result.id,
              after,
              changed: Object.keys(after ?? {}),
            });
          }
          return result;
        },

        async update({ model, args, query }) {
          const config = AUDITED_MODELS[model];
          if (!config) return query(args);
          const before = snapshot(await findBefore(model, args.where));
          const result = await query(args);
          const after = relationFree(afterRow(args, result, before), before);
          const changed = diff(before, after, [...ALWAYS_IGNORED, ...(config.ignore ?? [])]);
          if (changed.length) {
            await write({
              model,
              action: "UPDATE",
              entityId: before?.id ?? result.id,
              before,
              after,
              changed,
            });
          }
          return result;
        },

        async upsert({ model, args, query }) {
          const config = AUDITED_MODELS[model];
          if (!config) return query(args);
          const before = snapshot(await findBefore(model, args.where));
          const result = await query(args);
          const after = relationFree(afterRow(args, result, before), before);
          const changed = before
            ? diff(before, after, [...ALWAYS_IGNORED, ...(config.ignore ?? [])])
            : Object.keys(after ?? {});
          if (changed.length) {
            await write({
              model,
              action: before ? "UPDATE" : "CREATE",
              entityId: before?.id ?? result.id,
              before,
              after,
              changed,
            });
          }
          return result;
        },

        async delete({ model, args, query }) {
          if (!AUDITED_MODELS[model]) return query(args);
          const before = snapshot(await findBefore(model, args.where));
          const result = await query(args);
          await write({ model, action: "DELETE", entityId: before?.id, before, changed: [] });
          return result;
        },
      },
    },
  });
}

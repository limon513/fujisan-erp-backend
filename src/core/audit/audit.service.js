import prisma from "#core/db/prisma.js";
import { getContext } from "#core/context/requestContext.js";
import logger from "#core/utils/logger.js";

/**
 * Writes an audit entry. User, IP, device and request id come from the request context.
 * Pass `client` to write inside a transaction. Failures are logged, never thrown, unless
 * inside a transaction (where the caller decides).
 *
 * Automatic CREATE/UPDATE/DELETE capture for audited models arrives with step 1.5.
 */
export async function recordAudit(
  { action, entityType, entityId = null, description = null, oldValues, newValues, userId },
  client = prisma,
) {
  const context = getContext();
  const data = {
    action,
    entityType,
    entityId: entityId === null ? null : String(entityId),
    description,
    oldValues: oldValues ?? undefined,
    newValues: newValues ?? undefined,
    changedFields: oldValues && newValues ? changedKeys(oldValues, newValues) : [],
    userId: userId ?? context.userId ?? null,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
    requestId: context.requestId ?? null,
  };

  if (client !== prisma) return client.auditLog.create({ data });

  try {
    return await prisma.auditLog.create({ data });
  } catch (error) {
    logger.error({ err: error, action, entityType }, "Failed to write audit log");
    return null;
  }
}

const changedKeys = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );

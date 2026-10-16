import prisma from "#core/db/prisma.js";
import { getContext } from "#core/context/requestContext.js";
import logger from "#core/utils/logger.js";

/** Default wording for business events recorded without a description. */
const DEFAULT_DESCRIPTIONS = {
  LOGIN: "Signed in",
  LOGOUT: "Signed out",
  LOGOUT_ALL: "Signed out of all devices",
  PASSWORD_CHANGED: "Changed password",
  PASSWORD_RESET_REQUESTED: "Requested a password reset code",
  PASSWORD_RESET: "Reset password with an emailed code",
  SESSION_REVOKED: "Signed out a device",
  ACCOUNT_LOCKED: "Account locked after failed sign-ins",
};

/**
 * Writes an audit entry. User, IP, device and request id come from the request context.
 * Pass `client` to write inside a transaction. Failures are logged, never thrown, unless
 * inside a transaction (where the caller decides).
 *
 * Use it for business events (LOGIN, APPROVE, EXPORT, ...). Plain CREATE/UPDATE/DELETE on audited
 * models is captured automatically by the audit extension (audit.extension.js).
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
    description: description ?? DEFAULT_DESCRIPTIONS[action] ?? null,
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

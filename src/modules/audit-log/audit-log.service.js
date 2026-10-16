import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  auditLogDetailSelect,
  auditLogSelect,
  DHAKA_OFFSET,
  searchableFields,
} from "./audit-log.constant.js";

/** Adds `user: { id, username, name }` (AuditLog.userId has no FK so logs outlive users). */
const withUsers = async (rows) => {
  const ids = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, employee: { select: { fullName: true } } },
      })
    : [];
  const byId = new Map(
    users.map((u) => [
      u.id,
      { id: u.id, username: u.username, name: u.employee?.fullName ?? u.username },
    ]),
  );
  return rows.map(({ userId, ...row }) => ({
    ...row,
    user: userId ? (byId.get(userId) ?? null) : null,
  }));
};

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const { userId, entityType, entityId, action, from, to } = query;

  const where = {
    ...searchWhere,
    ...(userId && { userId }),
    ...(entityType && { entityType }),
    ...(entityId && { entityId }),
    ...(action && { action }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: new Date(`${from}T00:00:00${DHAKA_OFFSET}`) }),
        ...(to && { lte: new Date(`${to}T23:59:59.999${DHAKA_OFFSET}`) }),
      },
    }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, skip, take, orderBy, select: auditLogSelect }),
    prisma.auditLog.count({ where }),
  ]);
  return { data: await withUsers(rows), meta: paginationMeta(query, total) };
};

const getById = async (id) => {
  const row = await prisma.auditLog.findUnique({ where: { id }, select: auditLogDetailSelect });
  if (!row) throw AppError.notFound("Audit entry not found");
  const [withUser] = await withUsers([row]);
  return withUser;
};

/** Values that exist in the log, for filter dropdowns. */
const filterOptions = async () => {
  const [entityTypes, actions] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);
  return {
    entityTypes: entityTypes.map((r) => r.entityType),
    actions: actions.map((r) => r.action),
  };
};

export const AuditLogService = { list, getById, filterOptions };

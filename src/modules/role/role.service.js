import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { assertCanGrant, assertCanManageLevel } from "#core/rbac/guards.js";
import { compareScope } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  roleSelect,
  searchableFields,
  slugify,
  SUPER_ADMIN_SLUG,
  toRoleDto,
} from "./role.constant.js";

const findRole = async (id) => {
  const role = await prisma.role.findUnique({ where: { id }, select: roleSelect });
  if (!role) throw AppError.notFound("Role not found");
  return role;
};

const grantsOf = async (roleId) => {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { scope: true, permission: { select: { key: true } } },
  });
  return Object.fromEntries(rows.map((row) => [row.permission.key, row.scope]));
};

const assertNameAvailable = async (name, exceptId) => {
  const slug = slugify(name);
  const clash = await prisma.role.findFirst({
    where: {
      OR: [{ name: { equals: name, mode: "insensitive" } }, { slug }],
      id: { not: exceptId },
    },
  });
  if (clash)
    throw AppError.conflict("A role with this name already exists", [
      { path: "name", message: "Already exists" },
    ]);
  return slug;
};

// ---------------------------------------------------------------------------------------------

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const [rows, total] = await prisma.$transaction([
    prisma.role.findMany({ where: searchWhere, skip, take, orderBy, select: roleSelect }),
    prisma.role.count({ where: searchWhere }),
  ]);
  return { data: rows.map(toRoleDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => {
  const role = await findRole(id);
  return { ...toRoleDto(role), permissions: await grantsOf(id) };
};

const create = async (actor, { copyFromRoleId, ...data }) => {
  assertCanManageLevel(actor, data.level, "a role");
  const slug = await assertNameAvailable(data.name);

  let grants = [];
  if (copyFromRoleId) {
    const source = await findRole(copyFromRoleId);
    if (source.slug === SUPER_ADMIN_SLUG)
      throw AppError.unprocessable("Super Admin permissions can't be copied");
    grants = Object.entries(await grantsOf(copyFromRoleId)).map(([key, scope]) => ({ key, scope }));
    assertCanGrant(actor, grants);
  }

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({ data: { ...data, slug, createdById: actor.userId } });
    if (grants.length) {
      const permissions = await tx.permission.findMany({
        where: { key: { in: grants.map((g) => g.key) } },
        select: { id: true, key: true },
      });
      const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
      await tx.rolePermission.createMany({
        data: grants.map((g) => ({
          roleId: created.id,
          permissionId: idByKey.get(g.key),
          scope: g.scope,
        })),
      });
    }
    return created;
  });

  await recordAudit({
    action: "CREATE",
    entityType: "Role",
    entityId: role.id,
    newValues: { ...data, copiedFrom: copyFromRoleId ?? null },
  });
  return getById(role.id);
};

const update = async (actor, id, data) => {
  const role = await findRole(id);
  if (role.slug === SUPER_ADMIN_SLUG && !actor.isSuperAdmin) throw AppError.forbidden();
  if (role.slug === SUPER_ADMIN_SLUG && data.level !== undefined && data.level !== role.level) {
    throw AppError.unprocessable("The Super Admin level can't be changed");
  }
  assertCanManageLevel(actor, role.level);
  if (data.level !== undefined) assertCanManageLevel(actor, data.level, "a role");

  if (data.name && data.name !== role.name) await assertNameAvailable(data.name, id);

  const updated = await prisma.role.update({
    where: { id },
    // slug stays stable on rename: seed templates and code refer to roles by slug
    data: { ...data, updatedById: actor.userId },
    select: roleSelect,
  });

  const before = {
    name: role.name,
    description: role.description,
    level: role.level,
    require2FA: role.require2FA,
  };
  const after = {
    name: updated.name,
    description: updated.description,
    level: updated.level,
    require2FA: updated.require2FA,
  };
  await recordAudit({
    action: "UPDATE",
    entityType: "Role",
    entityId: id,
    oldValues: before,
    newValues: after,
  });
  return getById(id);
};

const remove = async (actor, id) => {
  const role = await findRole(id);
  if (role.isSystem) throw AppError.unprocessable("System roles can't be deleted");
  assertCanManageLevel(actor, role.level);
  if (role._count.users > 0) {
    throw AppError.conflict(
      `This role is assigned to ${role._count.users} user(s). Reassign them first.`,
    );
  }
  await prisma.role.delete({ where: { id } });
  await recordAudit({
    action: "DELETE",
    entityType: "Role",
    entityId: id,
    oldValues: { name: role.name, level: role.level },
  });
};

/**
 * Replaces a role's permissions. Non-Super-Admins can remove anything on roles they manage, but may
 * only add or widen permissions they hold themselves (no privilege escalation).
 */
const setPermissions = async (actor, id, { permissions }) => {
  const role = await findRole(id);
  if (role.slug === SUPER_ADMIN_SLUG)
    throw AppError.unprocessable("Super Admin always has full access");
  assertCanManageLevel(actor, role.level);

  const catalog = await prisma.permission.findMany({
    where: { key: { in: permissions.map((p) => p.key) } },
    select: { id: true, key: true, supportsScope: true },
  });
  const byKey = new Map(catalog.map((p) => [p.key, p]));
  const unknown = permissions.filter((p) => !byKey.has(p.key));
  if (unknown.length) {
    throw AppError.badRequest(
      "Unknown permission(s)",
      unknown.map((p) => ({ path: p.key, message: "Unknown permission" })),
    );
  }

  // Unscoped permissions are always stored as ALL
  const next = permissions.map((p) => ({
    key: p.key,
    scope: byKey.get(p.key).supportsScope ? p.scope : "ALL",
  }));
  const current = await grantsOf(id);

  const added = next.filter((p) => !current[p.key] || compareScope(p.scope, current[p.key]) > 0);
  assertCanGrant(actor, added);

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({
      data: next.map((p) => ({ roleId: id, permissionId: byKey.get(p.key).id, scope: p.scope })),
    }),
    prisma.role.update({
      where: { id },
      data: { permissionsVersion: { increment: 1 }, updatedById: actor.userId },
    }),
  ]);

  const nextMap = Object.fromEntries(next.map((p) => [p.key, p.scope]));
  await recordAudit({
    action: "PERMISSIONS_CHANGED",
    entityType: "Role",
    entityId: id,
    description: `Permissions of role "${role.name}" changed`,
    oldValues: current,
    newValues: nextMap,
  });
  return getById(id);
};

/** Permission catalog grouped by module, for the permission-matrix screen. */
const catalog = async () => {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { resource: "asc" }, { sortOrder: "asc" }],
    select: {
      key: true,
      module: true,
      resource: true,
      action: true,
      label: true,
      supportsScope: true,
    },
  });
  const modules = new Map();
  for (const permission of permissions) {
    if (!modules.has(permission.module)) modules.set(permission.module, []);
    modules.get(permission.module).push(permission);
  }
  return [...modules].map(([module, items]) => ({ module, permissions: items }));
};

export const RoleService = { list, getById, create, update, remove, setPermissions, catalog };

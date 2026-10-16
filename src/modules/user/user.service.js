import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { BLOCKED_EMPLOYMENT } from "#core/auth/actor.js";
import { assertCanManageLevel } from "#core/rbac/guards.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { generatePassword, hashPassword } from "#core/utils/password.js";
import { searchableFields, SUPER_ADMIN_SLUG, toUserDto, userSelect } from "./user.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const findUser = async (id) => {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: userSelect });
  if (!user) throw AppError.notFound("User not found");
  return user;
};

const findRole = async (roleId) => {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw invalid("roleId", "Role not found");
  return role;
};

/** The actor may only manage accounts (and assign roles) below their own role level. */
const assertManageable = (actor, role) =>
  assertCanManageLevel(actor, role.level, "users with this role");

const assertNotSelf = (actor, id, what) => {
  if (actor.userId === id) throw AppError.unprocessable(`You can't ${what} your own account`);
};

/** Keeps at least one active Super Admin. */
const assertOtherSuperAdmin = async (user) => {
  if (user.role.slug !== SUPER_ADMIN_SLUG) return;
  const others = await prisma.user.count({
    where: {
      id: { not: user.id },
      deletedAt: null,
      status: "ACTIVE",
      role: { slug: SUPER_ADMIN_SLUG },
    },
  });
  if (!others) throw AppError.unprocessable("This is the last active Super Admin");
};

const revokeSessions = (userId, reason) =>
  prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });

// ---------------------------------------------------------------------------------------------

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const now = new Date();
  const statusWhere =
    query.status === "LOCKED"
      ? { lockedUntil: { gt: now } }
      : query.status
        ? { status: query.status }
        : {};
  const where = {
    deletedAt: null,
    ...statusWhere,
    ...(query.roleId && { roleId: query.roleId }),
    ...(query.search && {
      OR: [
        ...searchWhere.OR,
        { employee: { fullName: { contains: query.search, mode: "insensitive" } } },
        { employee: { employeeCode: { contains: query.search, mode: "insensitive" } } },
      ],
    }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({ where, skip, take, orderBy, select: userSelect }),
    prisma.user.count({ where }),
  ]);
  return { data: rows.map(toUserDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toUserDto(await findUser(id));

/**
 * Creates a login. Without a password, a temporary one is generated and returned once
 * (`temporaryPassword`); the user must change it at first sign-in.
 */
const create = async (actor, { password, employeeId, ...data }) => {
  const role = await findRole(data.roleId);
  assertManageable(actor, role);

  let employee = null;
  if (employeeId) {
    employee = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { user: { select: { id: true } } },
    });
    if (!employee) throw invalid("employeeId", "Employee not found");
    if (employee.user) throw invalid("employeeId", "This employee already has a login");
    if (BLOCKED_EMPLOYMENT.includes(employee.employmentStatus)) {
      throw invalid("employeeId", "This employee is no longer active");
    }
  }

  const temporaryPassword = password ? null : generatePassword(12);
  const user = await prisma.user.create({
    data: {
      ...data,
      email: data.email ?? employee?.email?.toLowerCase() ?? null,
      mobile: data.mobile ?? employee?.mobile ?? null,
      employeeId: employee?.id ?? null,
      passwordHash: await hashPassword(password ?? temporaryPassword),
      mustChangePassword: temporaryPassword ? true : data.mustChangePassword,
      createdById: actor.userId,
    },
  });
  return { ...(await getById(user.id)), ...(temporaryPassword && { temporaryPassword }) };
};

const update = async (actor, id, data) => {
  const user = await findUser(id);
  assertManageable(actor, user.role);

  if (data.roleId && data.roleId !== user.role.id) {
    assertNotSelf(actor, id, "change the role of");
    assertManageable(actor, await findRole(data.roleId));
    await assertOtherSuperAdmin(user);
  }
  if (data.status === "INACTIVE" && user.status !== "INACTIVE") {
    assertNotSelf(actor, id, "deactivate");
    await assertOtherSuperAdmin(user);
  }

  await prisma.user.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  if (data.status === "INACTIVE") await revokeSessions(id, "USER_DEACTIVATED");
  if (data.roleId && data.roleId !== user.role.id) await revokeSessions(id, "ROLE_CHANGED");
  return getById(id);
};

/** Sets a new temporary password (returned once), unlocks, and signs the user out everywhere. */
const resetPassword = async (actor, id) => {
  const user = await findUser(id);
  assertManageable(actor, user.role);
  assertNotSelf(actor, id, "reset the password of (use Change password)");

  const temporaryPassword = generatePassword(12);
  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedById: actor.userId,
    },
  });
  await revokeSessions(id, "PASSWORD_RESET_BY_ADMIN");
  await recordAudit({
    action: "PASSWORD_RESET_BY_ADMIN",
    entityType: "User",
    entityId: id,
    description: `Reset the password of "${user.username}"`,
  });
  return { temporaryPassword };
};

const unlock = async (actor, id) => {
  const user = await findUser(id);
  assertManageable(actor, user.role);
  await prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await recordAudit({
    action: "ACCOUNT_UNLOCKED",
    entityType: "User",
    entityId: id,
    description: `Unlocked "${user.username}"`,
  });
  return getById(id);
};

/**
 * Deletes a login (soft): the username stays reserved for history, the employee is unlinked so
 * they can get a new login later.
 */
const remove = async (actor, id) => {
  const user = await findUser(id);
  assertManageable(actor, user.role);
  assertNotSelf(actor, id, "delete");
  await assertOtherSuperAdmin(user);

  await prisma.user.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      status: "INACTIVE",
      employeeId: null,
      updatedById: actor.userId,
    },
  });
  await revokeSessions(id, "USER_DELETED");
};

export const UserService = { list, getById, create, update, resetPassword, unlock, remove };

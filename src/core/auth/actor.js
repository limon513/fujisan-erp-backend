import prisma from "#core/db/prisma.js";

export const SUPER_ADMIN_ROLE = "super-admin";

/** Employment statuses that may not sign in. */
export const BLOCKED_EMPLOYMENT = ["SUSPENDED", "RESIGNED", "TERMINATED"];

// Role permissions cached per role and invalidated by role.permissionsVersion.
const permissionCache = new Map();

async function rolePermissions(roleId, version) {
  const cached = permissionCache.get(roleId);
  if (cached?.version === version) return cached.permissions;

  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { scope: true, permission: { select: { key: true } } },
  });
  const permissions = Object.fromEntries(rows.map((row) => [row.permission.key, row.scope]));
  permissionCache.set(roleId, { version, permissions });
  return permissions;
}

export const clearPermissionCache = () => permissionCache.clear();

/**
 * Loads the authenticated actor for an active session, or returns null when the session is
 * revoked/expired or the user can no longer sign in.
 *
 * Actor: { userId, sessionId, username, roleId, roleSlug, roleLevel, isSuperAdmin,
 *          employeeId, branchId, departmentId, teamIds, permissions, mustChangePassword }
 */
export async function loadActor({ userId, sessionId }) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          status: true,
          deletedAt: true,
          mustChangePassword: true,
          role: { select: { id: true, slug: true, level: true, permissionsVersion: true } },
          employee: {
            select: {
              id: true,
              branchId: true,
              departmentId: true,
              teamId: true,
              employmentStatus: true,
              ledTeams: { where: { deletedAt: null }, select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }

  const { user } = session;
  if (!isSignInAllowed(user)) return null;

  const { role, employee } = user;
  const teamIds = [
    ...new Set(
      [employee?.teamId, ...(employee?.ledTeams ?? []).map((team) => team.id)].filter(Boolean),
    ),
  ];

  return {
    userId: user.id,
    sessionId,
    username: user.username,
    roleId: role.id,
    roleSlug: role.slug,
    roleLevel: role.level,
    isSuperAdmin: role.slug === SUPER_ADMIN_ROLE,
    employeeId: employee?.id ?? null,
    branchId: employee?.branchId ?? null,
    departmentId: employee?.departmentId ?? null,
    teamIds,
    permissions: await rolePermissions(role.id, role.permissionsVersion),
    mustChangePassword: user.mustChangePassword,
  };
}

/** Shared by login and per-request checks. */
export function isSignInAllowed(user) {
  if (!user || user.deletedAt || user.status !== "ACTIVE") return false;
  if (user.employee && BLOCKED_EMPLOYMENT.includes(user.employee.employmentStatus)) return false;
  return true;
}

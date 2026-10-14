import { resolveTemplateScope } from "#core/rbac/permissions.js";

/** Collects permissions from module manifests; fails on a key declared twice. */
export function buildCatalog(modules) {
  const catalog = new Map();
  for (const m of modules) {
    for (const permission of m.permissions ?? []) {
      const existing = catalog.get(permission.key);
      if (existing) {
        throw new Error(
          `Permission "${permission.key}" declared by both "${existing.module}" and "${permission.module}"`,
        );
      }
      catalog.set(permission.key, permission);
    }
  }
  return [...catalog.values()];
}

/**
 * Syncs the permission catalog and system roles, then applies role templates to anything new.
 *
 * - New permission → granted to every system role whose template matches it.
 * - New system role → granted every catalog permission its template matches.
 * - Existing grants are never changed (permission-matrix edits survive re-seeding).
 * - Permissions no longer declared by any module are removed (with their grants).
 *
 * @returns summary counts
 */
export async function syncAccessControl(tx, { catalog, roles }) {
  const summary = {
    permissionsCreated: 0,
    permissionsRemoved: 0,
    rolesCreated: 0,
    grantsCreated: 0,
  };

  // 1. Permissions
  const existingPermissions = await tx.permission.findMany();
  const existingByKey = new Map(existingPermissions.map((p) => [p.key, p]));
  const catalogKeys = new Set(catalog.map((p) => p.key));
  const newPermissionIds = new Set();

  for (const permission of catalog) {
    const data = {
      module: permission.module,
      resource: permission.resource,
      action: permission.action,
      label: permission.label,
      supportsScope: permission.supportsScope,
      sortOrder: permission.sortOrder,
    };
    const existing = existingByKey.get(permission.key);
    if (existing) {
      await tx.permission.update({ where: { id: existing.id }, data });
    } else {
      const created = await tx.permission.create({ data: { key: permission.key, ...data } });
      newPermissionIds.add(created.id);
      summary.permissionsCreated++;
    }
  }

  const stale = existingPermissions.filter((p) => !catalogKeys.has(p.key));
  if (stale.length) {
    await tx.permission.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
    summary.permissionsRemoved = stale.length;
  }

  // 2. System roles
  const roleRows = [];
  for (const role of roles) {
    let row = await tx.role.findUnique({ where: { slug: role.slug } });
    let isNew = false;
    if (!row) {
      row = await tx.role.create({
        data: {
          slug: role.slug,
          name: role.name,
          description: role.description,
          level: role.level,
          require2FA: role.require2FA ?? false,
          isSystem: true,
        },
      });
      isNew = true;
      summary.rolesCreated++;
    }
    roleRows.push({ row, template: role.template, isNew });
  }

  // 3. Template grants for new roles (all permissions) and new permissions (all roles)
  const allPermissions = await tx.permission.findMany();
  for (const { row, template, isNew } of roleRows) {
    const targets = isNew
      ? allPermissions
      : allPermissions.filter((p) => newPermissionIds.has(p.id));
    const grants = targets
      .map((permission) => ({ permission, scope: resolveTemplateScope(template, permission) }))
      .filter(({ scope }) => scope)
      .map(({ permission, scope }) => ({ roleId: row.id, permissionId: permission.id, scope }));

    if (grants.length) {
      const { count } = await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
      summary.grantsCreated += count;
      if (count && !isNew) {
        await tx.role.update({
          where: { id: row.id },
          data: { permissionsVersion: { increment: 1 } },
        });
      }
    }
  }

  return summary;
}

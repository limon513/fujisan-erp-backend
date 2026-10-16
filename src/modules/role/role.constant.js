export const SUPER_ADMIN_SLUG = "super-admin";

/** Level 100 is reserved for Super Admin. */
export const MAX_CUSTOM_LEVEL = 99;

export const searchableFields = ["name", "slug", "description"];

export const sortableFields = ["level", "name", "createdAt"];

export const roleSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  level: true,
  isSystem: true,
  require2FA: true,
  permissionsVersion: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true, permissions: true } },
};

/** Flattens Prisma's _count into userCount / permissionCount. */
export const toRoleDto = ({ _count, ...role }) => ({
  ...role,
  userCount: _count?.users ?? 0,
  permissionCount: _count?.permissions ?? 0,
});

export const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const searchableFields = ["username", "email", "mobile"];

export const sortableFields = ["username", "createdAt", "lastLoginAt"];

export const SUPER_ADMIN_SLUG = "super-admin";

export const userSelect = {
  id: true,
  username: true,
  email: true,
  mobile: true,
  status: true,
  mustChangePassword: true,
  twoFactorEnabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, slug: true, level: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      designation: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  },
};

/** Adds `isLocked` (lockedUntil in the future). */
export const toUserDto = (user) => ({
  ...user,
  isLocked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
});

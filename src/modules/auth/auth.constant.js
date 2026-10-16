export const REFRESH_COOKIE = "erp_rt";

/** Cookie is sent only to auth endpoints. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

/** A just-rotated refresh secret is still accepted this long (parallel tabs refreshing at once). */
export const ROTATION_GRACE_MS = 30 * 1000;

export const RESET_CODE_TTL_MS = 10 * 60 * 1000;
export const RESET_CODE_MAX_ATTEMPTS = 5;

export const meSelect = {
  id: true,
  username: true,
  email: true,
  mobile: true,
  mustChangePassword: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
  role: { select: { id: true, name: true, slug: true, level: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      photoFileId: true,
      designation: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  },
};

export const sessionSelect = {
  id: true,
  deviceName: true,
  userAgent: true,
  ip: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
};

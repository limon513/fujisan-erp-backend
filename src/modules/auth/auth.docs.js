import { z } from "zod";
import config from "#config/index.js";
import { defineRoute } from "#core/docs/openapi.js";
import { AuthValidation as V } from "./auth.validation.js";

const tags = ["Auth"];
const DataScope = z.enum(["OWN", "TEAM", "DEPARTMENT", "BRANCH", "ALL"]);
const ref = z.object({ id: z.uuid(), name: z.string() });

const Me = z
  .object({
    id: z.uuid(),
    username: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    mustChangePassword: z.boolean(),
    twoFactorEnabled: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    isSuperAdmin: z.boolean(),
    role: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), level: z.number().int() }),
    employee: z
      .object({
        id: z.uuid(),
        employeeCode: z.string(),
        fullName: z.string(),
        photoFileId: z.uuid().nullable(),
        designation: ref,
        department: ref,
        branch: ref,
        team: ref.nullable(),
      })
      .nullable(),
    permissions: z
      .record(z.string(), DataScope)
      .meta({
        description: "Granted permission keys with their data scope",
        example: { "lead.view": "OWN" },
      }),
  })
  .meta({ id: "CurrentUser" });

const Tokens = z.object({
  accessToken: z.string().meta({ description: "Send as `Authorization: Bearer <token>`" }),
  expiresIn: z.number().int().meta({ description: "Access token lifetime in seconds" }),
});

const Session = z
  .object({
    id: z.uuid(),
    deviceName: z.string().nullable(),
    userAgent: z.string().nullable(),
    ip: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    current: z.boolean(),
  })
  .meta({ id: "Session" });

const LoginAttempt = z
  .object({
    id: z.uuid(),
    success: z.boolean(),
    failureReason: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "LoginAttempt" });

const cookieNote =
  "The refresh token is set as the httpOnly cookie `erp_rt` (path `/api/v1/auth`).";

defineRoute({
  method: "post",
  path: "/auth/login",
  tags,
  summary: "Sign in",
  description: `Sign in with username, email or mobile. ${cookieNote} After ${config.auth.maxFailedLogins} failed attempts the account is locked (423).`,
  request: { body: V.login },
  response: Tokens.extend({ user: Me }),
  auth: false,
  errors: [400, 401, 403, 423],
});

defineRoute({
  method: "post",
  path: "/auth/refresh",
  tags,
  summary: "Get a new access token",
  description: `Uses and rotates the refresh cookie. ${cookieNote} Reusing an old refresh token revokes the session.`,
  response: Tokens,
  auth: false,
  errors: [401],
});

defineRoute({
  method: "post",
  path: "/auth/logout",
  tags,
  summary: "Sign out this device",
  description:
    "Revokes the session of the refresh cookie and clears it. Works with an expired access token.",
  auth: false,
  errors: [],
});

defineRoute({
  method: "post",
  path: "/auth/logout-all",
  tags,
  summary: "Sign out of every device",
  response: z.object({ revokedSessions: z.number().int() }),
  errors: [401],
});

defineRoute({
  method: "get",
  path: "/auth/me",
  tags,
  summary: "Current user, role and permissions",
  response: Me,
  errors: [401],
});

defineRoute({
  method: "post",
  path: "/auth/change-password",
  tags,
  summary: "Change own password",
  description: "Signs out all other devices. Allowed while a password change is required.",
  request: { body: V.changePassword },
  errors: [400, 401],
});

defineRoute({
  method: "post",
  path: "/auth/forgot-password",
  tags,
  summary: "Email a 6-digit reset code",
  description:
    "Always returns 200 so it can't be used to discover accounts. The code expires in 10 minutes.",
  request: { body: V.forgotPassword },
  auth: false,
  errors: [400],
});

defineRoute({
  method: "post",
  path: "/auth/reset-password",
  tags,
  summary: "Reset password with the emailed code",
  description: "Signs out every device. Max 5 wrong codes per request.",
  request: { body: V.resetPassword },
  auth: false,
  errors: [400],
});

defineRoute({
  method: "get",
  path: "/auth/sessions",
  tags,
  summary: "List my active sessions (devices)",
  response: z.array(Session),
  errors: [401, 403],
});

defineRoute({
  method: "delete",
  path: "/auth/sessions/:id",
  tags,
  summary: "Sign out one of my devices",
  request: { params: V.sessionParams },
  errors: [401, 403, 404],
});

defineRoute({
  method: "get",
  path: "/auth/login-history",
  tags,
  summary: "My sign-in history",
  request: { query: V.loginHistoryQuery },
  response: LoginAttempt,
  paginated: true,
  errors: [400, 401, 403],
});

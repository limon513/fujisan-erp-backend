import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import config from "#config/index.js";
import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { isSignInAllowed, loadActor } from "#core/auth/actor.js";
import {
  formatRefreshToken,
  parseRefreshToken,
  randomSecret,
  safeEqualHex,
  sha256,
  signAccessToken,
} from "#core/auth/tokens.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { sendMail } from "#core/mail/mailer.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { hashPassword, verifyPassword } from "#core/utils/password.js";
import { normalizeBdMobile } from "#core/utils/validators.js";
import {
  meSelect,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MS,
  ROTATION_GRACE_MS,
  sessionSelect,
} from "./auth.constant.js";

// Compared against when the user doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = await hashPassword("dummy-password-for-timing");

const INVALID_CREDENTIALS = "Invalid username or password";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds a non-deleted user by username, email or mobile. */
const findByIdentifier = (identifier) => {
  const value = identifier.trim().toLowerCase();
  const mobile = normalizeBdMobile(value);
  return prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ username: value }, { email: value }, ...(mobile ? [{ mobile }] : [])],
    },
    include: { employee: { select: { employmentStatus: true } } },
  });
};

const recordLogin = (data) => prisma.loginHistory.create({ data });

const issueTokens = async (userId, session, secret) => ({
  accessToken: signAccessToken({ userId, sessionId: session.id }),
  expiresIn: config.auth.accessTtlSeconds,
  refreshToken: formatRefreshToken(session.id, secret),
  refreshExpiresAt: session.expiresAt,
});

const lockedMinutes = (lockedUntil) => Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));

// ---------------------------------------------------------------------------------------------

const login = async ({ identifier, password, deviceName }, { ip, userAgent }) => {
  const user = await findByIdentifier(identifier);
  const history = { identifier: identifier.slice(0, 150), ip, userAgent, userId: user?.id ?? null };

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    await recordLogin({ ...history, success: false, failureReason: "UNKNOWN_USER" });
    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin({ ...history, success: false, failureReason: "LOCKED" });
    throw new AppError(
      StatusCodes.LOCKED,
      `Too many failed attempts. Try again in ${lockedMinutes(user.lockedUntil)} minute(s).`,
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= config.auth.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + config.auth.lockoutMs) }
        : { failedLoginCount: failed },
    });
    await recordLogin({ ...history, success: false, failureReason: "BAD_PASSWORD" });
    if (lock) {
      await recordAudit({
        action: "ACCOUNT_LOCKED",
        entityType: "User",
        entityId: user.id,
        userId: user.id,
        description: `Locked after ${failed} failed sign-in attempts`,
      });
      throw new AppError(
        StatusCodes.LOCKED,
        `Too many failed attempts. Try again in ${lockedMinutes(Date.now() + config.auth.lockoutMs)} minute(s).`,
      );
    }
    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }

  if (!isSignInAllowed(user)) {
    await recordLogin({ ...history, success: false, failureReason: "DISABLED" });
    throw AppError.forbidden("This account is disabled. Contact your administrator.");
  }

  const secret = randomSecret();
  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return tx.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(secret),
        deviceName,
        userAgent,
        ip,
        expiresAt: new Date(Date.now() + config.auth.refreshTtlMs),
      },
    });
  });

  await recordLogin({ ...history, success: true });
  await recordAudit({ action: "LOGIN", entityType: "User", entityId: user.id, userId: user.id });

  const actor = await loadActor({ userId: user.id, sessionId: session.id });
  return { ...(await issueTokens(user.id, session, secret)), user: await getMe(actor) };
};

/**
 * Rotates the refresh token. An outdated secret means the token was copied/stolen → the whole
 * session is revoked. The previous secret stays valid for ROTATION_GRACE_MS (parallel tabs).
 */
const refresh = async (rawToken, { ip, userAgent }) => {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed || !UUID_RE.test(parsed.sessionId)) throw AppError.unauthorized("Please sign in");

  const presentedHash = sha256(parsed.secret);

  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: { include: { employee: { select: { employmentStatus: true } } } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw AppError.unauthorized("Session expired, please sign in again");
    }

    const isCurrent = safeEqualHex(presentedHash, session.refreshTokenHash);
    const isGracePrevious =
      safeEqualHex(presentedHash, session.previousTokenHash) &&
      session.rotatedAt > new Date(Date.now() - ROTATION_GRACE_MS);

    if (!isCurrent && !isGracePrevious) {
      await revokeSession(session.id, "TOKEN_REUSE");
      await recordAudit({
        action: "SESSION_REVOKED",
        entityType: "Session",
        entityId: session.id,
        userId: session.userId,
        description: "Refresh token reuse detected — session revoked",
      });
      throw AppError.unauthorized("Session expired, please sign in again");
    }

    if (!isSignInAllowed(session.user)) {
      await revokeSession(session.id, "USER_DISABLED");
      throw AppError.unauthorized("This account is disabled");
    }

    const secret = randomSecret();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.auth.refreshTtlMs);
    // Conditional update: if another request rotated in between, re-read and try again.
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: {
        refreshTokenHash: sha256(secret),
        previousTokenHash: session.refreshTokenHash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt,
        ip,
        userAgent,
      },
    });
    if (count === 1) return issueTokens(session.userId, { id: session.id, expiresAt }, secret);
  }

  throw AppError.unauthorized("Session expired, please sign in again");
};

const revokeSession = (sessionId, reason) =>
  prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });

/** Logout with the refresh cookie (works even when the access token has expired). */
const logout = async (rawToken) => {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed || !UUID_RE.test(parsed.sessionId)) return;
  const session = await prisma.session.findUnique({ where: { id: parsed.sessionId } });
  if (!session || session.revokedAt) return;
  const hash = sha256(parsed.secret);
  if (
    !safeEqualHex(hash, session.refreshTokenHash) &&
    !safeEqualHex(hash, session.previousTokenHash)
  ) {
    return;
  }
  await revokeSession(session.id, "LOGOUT");
  await recordAudit({
    action: "LOGOUT",
    entityType: "User",
    entityId: session.userId,
    userId: session.userId,
  });
};

const logoutAll = async (actor) => {
  const { count } = await prisma.session.updateMany({
    where: { userId: actor.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "LOGOUT_ALL" },
  });
  await recordAudit({
    action: "LOGOUT_ALL",
    entityType: "User",
    entityId: actor.userId,
    description: `Signed out of ${count} session(s)`,
  });
  return { revokedSessions: count };
};

const getMe = async (actor) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: meSelect,
  });
  return { ...user, isSuperAdmin: actor.isSuperAdmin, permissions: actor.permissions };
};

const changePassword = async (actor, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw AppError.badRequest("Current password is incorrect", [
      { path: "currentPassword", message: "Incorrect password" },
    ]);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    }),
    // Sign out every other device; keep the current one
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: actor.sessionId } },
      data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" },
    }),
  ]);
  await recordAudit({ action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id });
};

/** Always succeeds from the caller's view, so it can't be used to discover accounts. */
const forgotPassword = async ({ identifier }) => {
  const user = await findByIdentifier(identifier);
  if (!user?.email || !isSignInAllowed(user)) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    prisma.otpToken.updateMany({
      where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.otpToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        codeHash: sha256(`${user.id}:${code}`),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      },
    }),
  ]);

  await sendMail({
    to: user.email,
    subject: `${config.appName}: password reset code`,
    text:
      `Your password reset code is ${code}.\n\n` +
      `It expires in ${RESET_CODE_TTL_MS / 60000} minutes. If you didn't request this, ignore this email.`,
  });
  await recordAudit({
    action: "PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
  });
};

const resetPassword = async ({ identifier, code, newPassword }) => {
  const invalid = AppError.badRequest("Invalid or expired code", [
    { path: "code", message: "Invalid or expired code" },
  ]);
  const user = await findByIdentifier(identifier);
  if (!user) throw invalid;

  const token = await prisma.otpToken.findFirst({
    where: {
      userId: user.id,
      purpose: "PASSWORD_RESET",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!token || token.attempts >= RESET_CODE_MAX_ATTEMPTS) throw invalid;

  if (!safeEqualHex(sha256(`${user.id}:${code}`), token.codeHash)) {
    await prisma.otpToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }

  await prisma.$transaction([
    prisma.otpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "PASSWORD_RESET" },
    }),
  ]);
  await recordAudit({
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
  });
};

const listSessions = async (actor) => {
  const sessions = await prisma.session.findMany({
    where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: sessionSelect,
  });
  return sessions.map((session) => ({ ...session, current: session.id === actor.sessionId }));
};

const revokeOwnSession = async (actor, sessionId) => {
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, userId: actor.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" },
  });
  if (!count) throw AppError.notFound("Session not found");
  await recordAudit({ action: "SESSION_REVOKED", entityType: "Session", entityId: sessionId });
};

const loginHistory = async (actor, query) => {
  const { skip, take, orderBy } = buildListArgs(query);
  const where = { userId: actor.userId };
  const [data, total] = await prisma.$transaction([
    prisma.loginHistory.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        success: true,
        failureReason: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    }),
    prisma.loginHistory.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

export const AuthService = {
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  changePassword,
  forgotPassword,
  resetPassword,
  listSessions,
  revokeOwnSession,
  loginHistory,
};

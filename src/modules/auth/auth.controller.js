import config from "#config/index.js";
import AppError from "#core/errors/AppError.js";
import sendResponse from "#core/utils/sendResponse.js";
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from "./auth.constant.js";
import { AuthService } from "./auth.service.js";

const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "strict",
  path: REFRESH_COOKIE_PATH,
};

const requestMeta = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? null });

/** Sets the refresh cookie and returns the token fields safe to put in the body. */
const withRefreshCookie = (res, { refreshToken, refreshExpiresAt, ...rest }) => {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, expires: refreshExpiresAt });
  return rest;
};

const login = async (req, res) => {
  const result = await AuthService.login(req.body, requestMeta(req));
  return sendResponse(res, { message: "Signed in", data: withRefreshCookie(res, result) });
};

const refresh = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw AppError.unauthorized("Please sign in");
  try {
    const result = await AuthService.refresh(token, requestMeta(req));
    return sendResponse(res, { message: "Token refreshed", data: withRefreshCookie(res, result) });
  } catch (error) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw error;
  }
};

const logout = async (req, res) => {
  await AuthService.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  return sendResponse(res, { message: "Signed out", data: null });
};

const logoutAll = async (req, res) => {
  const data = await AuthService.logoutAll(req.actor);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  return sendResponse(res, { message: "Signed out of all devices", data });
};

const me = async (req, res) => {
  const data = await AuthService.getMe(req.actor);
  return sendResponse(res, { message: "Current user", data });
};

const changePassword = async (req, res) => {
  await AuthService.changePassword(req.actor, req.body);
  return sendResponse(res, { message: "Password changed", data: null });
};

const forgotPassword = async (req, res) => {
  await AuthService.forgotPassword(req.body);
  return sendResponse(res, {
    message: "If the account exists and has an email address, a reset code has been sent",
    data: null,
  });
};

const resetPassword = async (req, res) => {
  await AuthService.resetPassword(req.body);
  return sendResponse(res, { message: "Password reset. Please sign in.", data: null });
};

const listSessions = async (req, res) => {
  const data = await AuthService.listSessions(req.actor);
  return sendResponse(res, { message: "Active sessions", data });
};

const revokeSession = async (req, res) => {
  await AuthService.revokeOwnSession(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Session revoked", data: null });
};

const loginHistory = async (req, res) => {
  const { data, meta } = await AuthService.loginHistory(req.actor, req.valid.query);
  return sendResponse(res, { message: "Login history", data, meta });
};

export const AuthController = {
  login,
  refresh,
  logout,
  logoutAll,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  listSessions,
  revokeSession,
  loginHistory,
};

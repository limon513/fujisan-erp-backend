import AppError from "#core/errors/AppError.js";
import { loadActor } from "#core/auth/actor.js";
import { verifyAccessToken } from "#core/auth/tokens.js";
import { setContext } from "#core/context/requestContext.js";

/**
 * Requires a valid bearer access token and an active session; sets `req.actor`.
 *
 * Users flagged `mustChangePassword` are rejected with 403 unless the route opts in with
 * `authenticate({ allowPasswordChangePending: true })` (me, change-password, logout).
 */
export function authenticate({ allowPasswordChangePending = false } = {}) {
  return async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw AppError.unauthorized();

    const claims = verifyAccessToken(token);
    if (!claims) throw AppError.unauthorized("Session expired, please sign in again");

    const actor = await loadActor(claims);
    if (!actor) throw AppError.unauthorized("Session expired, please sign in again");

    if (actor.mustChangePassword && !allowPasswordChangePending) {
      throw new AppError(403, "You must change your password before continuing", [
        { path: "password", message: "PASSWORD_CHANGE_REQUIRED" },
      ]);
    }

    req.actor = actor;
    setContext({ userId: actor.userId, sessionId: actor.sessionId });
    next();
  };
}

export default authenticate();

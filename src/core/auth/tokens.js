import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import config from "#config/index.js";

const ISSUER = "erp-api";

/** Short-lived access token. Claims are minimal; the actor is loaded from the DB per request. */
export const signAccessToken = ({ userId, sessionId }) =>
  jwt.sign({ sid: sessionId }, config.auth.accessSecret, {
    subject: userId,
    issuer: ISSUER,
    expiresIn: config.auth.accessTtlSeconds,
    algorithm: "HS256",
  });

/** @returns {{ userId, sessionId } | null} */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.auth.accessSecret, {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const randomSecret = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Refresh token = "<session id>.<secret>"; only sha256(secret) is stored. */
export const formatRefreshToken = (sessionId, secret) => `${sessionId}.${secret}`;

export function parseRefreshToken(token) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

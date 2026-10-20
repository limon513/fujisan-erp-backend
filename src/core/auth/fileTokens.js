import jwt from "jsonwebtoken";
import config from "#config/index.js";

const AUDIENCE = "file";
export const FILE_URL_TTL_SECONDS = 10 * 60;

/** Short-lived token that allows downloading one file (for <img src> / links, which can't send headers). */
export const signFileToken = (fileId) =>
  jwt.sign({ fid: fileId }, config.auth.accessSecret, {
    audience: AUDIENCE,
    expiresIn: FILE_URL_TTL_SECONDS,
    algorithm: "HS256",
  });

/** @returns {boolean} whether the token is valid for this file id */
export function verifyFileToken(token, fileId) {
  try {
    const payload = jwt.verify(token, config.auth.accessSecret, {
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return payload.fid === fileId;
  } catch {
    return false;
  }
}

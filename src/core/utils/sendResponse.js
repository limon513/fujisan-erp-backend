import { StatusCodes } from "http-status-codes";

/**
 * Standard success envelope: { success, message, data, meta? }
 */
export default function sendResponse(res, { statusCode = StatusCodes.OK, message, data, meta }) {
  const body = { success: true, message };
  if (data !== undefined) body.data = data;
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
}

import { StatusCodes } from "http-status-codes";
import config from "#config/index.js";
import normalizeError from "#core/errors/normalizeError.js";
import logger from "#core/utils/logger.js";

// Express identifies error handlers by their 4-argument signature, so `_next` must stay.
export default function errorHandler(error, req, res, _next) {
  const appError = normalizeError(error);

  if (appError) {
    return res.status(appError.statusCode).json({
      success: false,
      message: appError.message,
      errors: appError.errors,
    });
  }

  logger.error({ err: error, requestId: req.id }, "Unhandled error");

  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "Something went wrong",
    errors: [],
    ...(config.isProduction ? {} : { stack: error?.stack }),
  });
}

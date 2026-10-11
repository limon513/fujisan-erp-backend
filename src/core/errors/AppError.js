import { StatusCodes } from "http-status-codes";

/**
 * Expected (operational) error. Anything thrown as AppError is shown to the client as-is;
 * any other error becomes a generic 500.
 */
export default class AppError extends Error {
  constructor(statusCode, message, errors = []) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }

  static badRequest(message = "Bad request", errors) {
    return new AppError(StatusCodes.BAD_REQUEST, message, errors);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(StatusCodes.UNAUTHORIZED, message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError(StatusCodes.FORBIDDEN, message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(StatusCodes.NOT_FOUND, message);
  }

  static conflict(message = "Conflict", errors) {
    return new AppError(StatusCodes.CONFLICT, message, errors);
  }

  /** Request is valid but breaks a business rule (e.g. booking a sold plot). */
  static unprocessable(message, errors) {
    return new AppError(StatusCodes.UNPROCESSABLE_ENTITY, message, errors);
  }
}

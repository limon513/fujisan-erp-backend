import AppError from "#core/errors/AppError.js";

export default function notFound(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Validates request parts with zod schemas: validate({ body, query, params }).
 *
 * Parsed (coerced, defaulted, stripped) values are available on `req.valid.{body,query,params}`.
 * `req.body` is also replaced with the parsed body. (Express 5 makes `req.query` read-only,
 * so always read query values from `req.valid.query`.)
 */
export default function validate(schemas) {
  return async (req, _res, next) => {
    req.valid ??= {};
    for (const part of ["params", "query", "body"]) {
      if (!schemas[part]) continue;
      // ZodError is turned into a 400 response by the error handler
      req.valid[part] = await schemas[part].parseAsync(req[part] ?? {});
    }
    if (req.valid.body) req.body = req.valid.body;
    next();
  };
}

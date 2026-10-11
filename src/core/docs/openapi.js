import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import config from "#config/index.js";

/**
 * OpenAPI (Swagger) registry. Each module registers its endpoints in `<module>.docs.js`
 * using the same zod schemas it validates with, so docs and validation can't drift apart.
 */
export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export const ErrorResponse = z
  .object({
    success: z.literal(false),
    message: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })),
  })
  .meta({ id: "ErrorResponse" });

export const PaginationMeta = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: "PaginationMeta" });

export const successResponse = (data) =>
  z.object({ success: z.literal(true), message: z.string(), data });

export const paginatedResponse = (item) =>
  z.object({
    success: z.literal(true),
    message: z.string(),
    data: z.array(item),
    meta: PaginationMeta,
  });

const errorDescriptions = {
  400: "Validation failed",
  401: "Authentication required",
  403: "Permission denied",
  404: "Not found",
  409: "Conflict",
  422: "Business rule violated",
};

const jsonContent = (schema) => ({ "application/json": { schema } });

/**
 * Register one endpoint.
 *
 * @param {object} route
 * @param {"get"|"post"|"put"|"patch"|"delete"} route.method
 * @param {string} route.path      Express-style path under /api/v1, e.g. "/projects/:id"
 * @param {string[]} route.tags
 * @param {string} route.summary
 * @param {{ params?, query?, body? }} [route.request]  zod schemas
 * @param {import("zod").ZodType} [route.response]     schema of the `data` field
 * @param {boolean} [route.paginated]  response is a paginated list of `response`
 * @param {number} [route.status]      success status code (default 200)
 * @param {boolean} [route.auth]       requires bearer token (default true)
 * @param {number[]} [route.errors]    documented error statuses
 */
export function defineRoute({
  method,
  path,
  tags,
  summary,
  description,
  request = {},
  response = z.null(),
  paginated = false,
  status = 200,
  auth = true,
  errors = [400, 401, 403],
}) {
  const responses = {
    [status]: {
      description: "Success",
      content: jsonContent(paginated ? paginatedResponse(response) : successResponse(response)),
    },
  };
  for (const code of errors) {
    responses[code] = {
      description: errorDescriptions[code] ?? "Error",
      content: jsonContent(ErrorResponse),
    };
  }

  registry.registerPath({
    method,
    path: path.replace(/:(\w+)/g, "{$1}"),
    tags,
    summary,
    description,
    security: auth ? [{ bearerAuth: [] }] : [],
    request: {
      ...(request.params && { params: request.params }),
      ...(request.query && { query: request.query }),
      ...(request.body && { body: { content: jsonContent(request.body), required: true } }),
    },
    responses,
  });
}

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: `${config.appName} API`,
      version: "1.0.0",
      description:
        "All responses use the envelope `{ success, message, data, meta? }`. " +
        "Errors use `{ success: false, message, errors: [{ path, message }] }`.",
    },
    servers: [{ url: "/api/v1" }],
  });
}

import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./openapi.js";

/** Serves the OpenAPI JSON at /api/docs.json and Swagger UI at /api/docs. */
export function mountApiDocs(app) {
  let document;
  const getDocument = () => (document ??= buildOpenApiDocument());

  app.get("/api/docs.json", (_req, res) => res.json(getDocument()));

  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: "API Docs",
      swaggerOptions: { url: "/api/docs.json", persistAuthorization: true },
    }),
  );
}

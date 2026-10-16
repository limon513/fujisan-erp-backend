import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import config from "#config/index.js";
import logger from "#core/utils/logger.js";
import requestContext from "#core/middleware/requestContext.js";
import { apiLimiter } from "#core/middleware/rateLimit.js";
import notFound from "#core/middleware/notFound.js";
import errorHandler from "#core/middleware/errorHandler.js";
import { mountApiDocs } from "#core/docs/swagger.js";
import { buildApiRouter } from "./routes/index.js";

export async function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Number of proxies in front of the API (Vercel rewrite + Render = 2) so req.ip is the client
  app.set("trust proxy", config.trustProxy);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: !config.isTest,
      quietReqLogger: true,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      customSuccessMessage: (req, res, time) =>
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(time)}ms`,
      customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
      serializers: { req: () => undefined, res: () => undefined },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // server-to-server / curl requests have no Origin header
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(cookieParser());

  const { router } = await buildApiRouter();
  app.use("/api/v1", apiLimiter, router);

  if (config.apiDocsEnabled) mountApiDocs(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

import config from "#config/index.js";
import logger from "#core/utils/logger.js";
import prisma from "#core/db/prisma.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs/index.js";

const app = await createApp();

await prisma.$connect();
const stopJobs = startJobs();

const server = app.listen(config.port, () => {
  logger.info(`${config.appName} API listening on http://localhost:${config.port} (${config.env})`);
  if (config.apiDocsEnabled) logger.info(`API docs: http://localhost:${config.port}/api/docs`);
});

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down`);
  stopJobs();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

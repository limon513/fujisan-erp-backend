import pino from "pino";
import config from "#config/index.js";

const logger = pino({
  level: config.isTest ? "silent" : config.logLevel,
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
  ...(config.isProduction
    ? {}
    : { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }),
});

export default logger;

import "dotenv/config";
import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_NAME: z.string().default("Real Estate ERP"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGINS: csv,
  ENABLED_MODULES: z.string().default("*"),
  API_DOCS_ENABLED: bool,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  appName: env.APP_NAME,
  databaseUrl: env.DATABASE_URL,
  corsOrigins: env.CORS_ORIGINS,
  enabledModules:
    env.ENABLED_MODULES.trim() === "*"
      ? "*"
      : env.ENABLED_MODULES.split(",")
          .map((name) => name.trim())
          .filter(Boolean),
  apiDocsEnabled: env.API_DOCS_ENABLED,
  logLevel: env.LOG_LEVEL,
});

export default config;

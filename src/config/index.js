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
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Mail (password reset, notifications). Without SMTP_HOST mail is logged instead of sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("ERP <no-reply@localhost>"),
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
  trustProxy: env.TRUST_PROXY,
  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtlSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    maxFailedLogins: env.MAX_FAILED_LOGINS,
    lockoutMs: env.LOCKOUT_MINUTES * 60 * 1000,
  },
  mail: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  },
});

export default config;

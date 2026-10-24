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

  // Mail (password reset, notifications): Resend's HTTP API when RESEND_API_KEY is set, else SMTP
  // when SMTP_HOST is set, else the mail is logged instead of sent.
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("ERP <no-reply@localhost>"),

  // File storage: "local" (development) or "s3" (any S3-compatible service, e.g. Cloudflare R2)
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  // Interactive transactions run many small queries; against a far-away database (e.g. developing
  // on a laptop against Neon) each is a network round trip, so allow more than Prisma's 5 s.
  DB_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

// S3_* settings fall back to the standard AWS variable names, so a provider's ready-made block
// (Neon storage, AWS, R2 examples) can be pasted as-is. Empty values count as unset.
const pick = (...names) => names.map((name) => process.env[name]).find((value) => value);
const source = {
  ...process.env,
  S3_ENDPOINT: pick("S3_ENDPOINT", "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL"),
  S3_REGION: pick("S3_REGION", "AWS_REGION", "AWS_DEFAULT_REGION"),
  S3_ACCESS_KEY_ID: pick("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
  S3_SECRET_ACCESS_KEY: pick("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
};

const parsed = envSchema
  .refine(
    (e) =>
      e.STORAGE_DRIVER !== "s3" || (e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY),
    {
      path: ["S3_BUCKET"],
      message:
        "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3",
    },
  )
  .safeParse(source);

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
  dbTransactionTimeoutMs: env.DB_TRANSACTION_TIMEOUT_MS,
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
  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
    s3: {
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
  mail: {
    resendApiKey: env.RESEND_API_KEY || undefined,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  },
});

export default config;

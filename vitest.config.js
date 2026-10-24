import "dotenv/config";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required to run tests");
// Tests truncate every table: never let them near a hosted database
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(testDatabaseUrl)) {
  throw new Error("TEST_DATABASE_URL must point at a local Postgres");
}

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      // Both URLs: Prisma prefers DIRECT_DATABASE_URL, which in development points at Neon
      DATABASE_URL: testDatabaseUrl,
      DIRECT_DATABASE_URL: testDatabaseUrl,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: ".test-storage",
      MAX_UPLOAD_MB: "1",
    },
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/setup/global.js"],
    // DB-backed test files share one database, so run files one at a time
    fileParallelism: false,
  },
});

import "dotenv/config";
import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required to run tests");

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
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

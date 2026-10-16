import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed/index.js",
  },
  // Migrations need a direct (non-pooled) connection; the app itself uses DATABASE_URL.
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
});

#!/usr/bin/env node
/**
 * Creates a migration from the difference between the database and prisma/schema, without the
 * interactive prompts of `prisma migrate dev` (which hang in non-interactive shells/CI), then
 * applies it.
 *
 *   npm run db:new-migration -- <snake_case_name>
 *
 * Review the generated SQL before committing — dropped columns lose their data.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: npm run db:new-migration -- <snake_case_name>");
  process.exit(1);
}

// Development-only tool: never create migrations against a hosted (demo/production) database.
const target = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(target).hostname;
  } catch {
    return "";
  }
})();
if (
  !["localhost", "127.0.0.1", "::1", ""].includes(host) &&
  process.env.ALLOW_REMOTE_DB !== "true"
) {
  console.error(`Refusing to create a migration against remote database host "${host}".`);
  console.error(
    "Point DATABASE_URL at local Postgres, or set ALLOW_REMOTE_DB=true if you really mean it.",
  );
  process.exit(1);
}

const prisma = (args) => execFileSync("npx", ["prisma", ...args], { encoding: "utf8" });

const sql = prisma([
  "migrate",
  "diff",
  "--from-config-datasource",
  "--to-schema",
  "prisma/schema",
  "--script",
]);
if (!sql.trim() || /^-- This is an empty migration/.test(sql.trim())) {
  console.log("Schema and database are in sync — nothing to migrate.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const dir = path.join("prisma", "migrations", `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "migration.sql"), sql);
console.log(`Created ${dir}/migration.sql\n\n${sql}`);

try {
  console.log(prisma(["migrate", "deploy"]));
  console.log(prisma(["generate"]));
} catch (error) {
  rmSync(dir, { recursive: true, force: true });
  console.error("Migration failed and was removed:", error.message);
  process.exit(1);
}

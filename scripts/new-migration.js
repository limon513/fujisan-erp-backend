#!/usr/bin/env node
/**
 * Creates a migration from the difference between the database and prisma/schema, without the
 * interactive prompts of `prisma migrate dev` (which hang in non-interactive shells/CI), then
 * applies it.
 *
 *   npm run db:new-migration -- <snake_case_name>
 *
 * With MIGRATION_DATABASE_URL set (local Postgres), the migration is drafted and applied there;
 * apply it to the app database (DATABASE_URL, e.g. the hosted dev/demo one) with `npm run db:deploy`.
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

// Migrations are drafted against a local scratch database (MIGRATION_DATABASE_URL), also when
// DATABASE_URL points at the hosted dev/demo database; `npm run db:deploy` then applies them there.
// Never draft against a hosted database: the diff would run on real data.
const draftUrl = process.env.MIGRATION_DATABASE_URL;
const childEnv = draftUrl
  ? { ...process.env, DATABASE_URL: draftUrl, DIRECT_DATABASE_URL: draftUrl }
  : process.env;
const target = draftUrl || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "";
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
    "Set MIGRATION_DATABASE_URL to a local Postgres, or ALLOW_REMOTE_DB=true if you really mean it.",
  );
  process.exit(1);
}

const prisma = (args) =>
  execFileSync("npx", ["prisma", ...args], { encoding: "utf8", env: childEnv });

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
  if (draftUrl) console.log("Applied to the local draft database. Now run: npm run db:deploy");
} catch (error) {
  rmSync(dir, { recursive: true, force: true });
  console.error("Migration failed and was removed:", error.message);
  process.exit(1);
}

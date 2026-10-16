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

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: npm run db:new-migration -- <snake_case_name>");
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

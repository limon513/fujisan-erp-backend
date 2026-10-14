import { execFileSync } from "node:child_process";

/** Applies migrations to the test database before the run. */
export default function setup() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "ignore",
  });
}

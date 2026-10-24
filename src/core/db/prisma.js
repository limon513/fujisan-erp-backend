import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";
import config from "#config/index.js";
import { auditExtension } from "#core/audit/audit.extension.js";

const adapter = new PrismaPg({ connectionString: config.databaseUrl });

/** Un-extended client: used by the audit extension itself (and nowhere else). */
export const basePrisma = new PrismaClient({
  adapter,
  transactionOptions: { timeout: config.dbTransactionTimeoutMs, maxWait: 10_000 },
});

/** App client: every create/update/delete on audited models is written to AuditLog. */
const prisma = basePrisma.$extends(auditExtension(basePrisma));

export default prisma;

/**
 * The pg adapter assumes the session time zone is UTC (see the utc_session_timezone migration).
 * Refuse to run otherwise — a wrong zone would silently shift every stored timestamp.
 */
export async function assertUtcSession() {
  const [{ timezone }] = await basePrisma.$queryRaw`SELECT current_setting('TimeZone') AS timezone`;
  if (!["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Universal", "Zulu"].includes(timezone)) {
    throw new Error(
      `Database session time zone is "${timezone}", expected UTC. Run the migrations ` +
        "(utc_session_timezone sets it), or ALTER DATABASE <name> SET timezone TO 'UTC'.",
    );
  }
}

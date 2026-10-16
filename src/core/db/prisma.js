import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";
import config from "#config/index.js";
import { auditExtension } from "#core/audit/audit.extension.js";

const adapter = new PrismaPg({ connectionString: config.databaseUrl });

/** Un-extended client: used by the audit extension itself (and nowhere else). */
export const basePrisma = new PrismaClient({ adapter });

/** App client: every create/update/delete on audited models is written to AuditLog. */
const prisma = basePrisma.$extends(auditExtension(basePrisma));

export default prisma;

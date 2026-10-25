/**
 * Idempotent seed: safe to run on every deploy (`npm run db:seed`).
 *
 *   SEED_CLIENT          client data set in prisma/seed/clients/ (default "fujisan")
 *   SEED_ADMIN_USERNAME  first Super Admin username (default "superadmin")
 *   SEED_ADMIN_EMAIL     optional
 *   SEED_ADMIN_PASSWORD  if empty a strong password is generated and printed once
 */
import prisma from "#core/db/prisma.js";
import { generatePassword, hashPassword } from "#core/utils/password.js";
import { discoverModules } from "../../src/routes/index.js";
import { systemRoles } from "./core/roles.js";
import { buildCatalog, syncAccessControl } from "./core/accessControl.js";
import { syncApprovalWorkflows } from "./core/approvals.js";
import { syncChartOfAccounts } from "./core/chartOfAccounts.js";
import { toCode } from "../../src/modules/lead-source/lead-source.constant.js";

const clientName = process.env.SEED_CLIENT || "fujisan";
// Many small queries; from a laptop to a hosted database each one is a network round trip
const TX_OPTIONS = { timeout: 120_000, maxWait: 20_000 };
const { default: client } = await import(`./clients/${clientName}.js`);

async function seedCompany() {
  const existing = await prisma.company.findUnique({ where: { singleton: true } });
  if (!existing) {
    await prisma.company.create({ data: client.company });
    console.log(`  company: created "${client.company.name}"`);
  }
}

/** Creates missing org records by code; never overwrites edits made in the app. */
async function seedOrganization() {
  for (const branch of client.branches ?? []) {
    const exists = await prisma.branch.findUnique({ where: { code: branch.code } });
    if (!exists) await prisma.branch.create({ data: branch });
  }
  for (const department of client.departments ?? []) {
    const exists = await prisma.department.findUnique({ where: { code: department.code } });
    if (!exists) await prisma.department.create({ data: department });
  }
}

/** Creates missing lead sources by code (FACEBOOK, WALK_IN, ...); app edits are kept. */
async function seedLeadSources() {
  let created = 0;
  for (const [index, name] of (client.leadSources ?? []).entries()) {
    const code = toCode(name);
    if (await prisma.leadSource.findUnique({ where: { code } })) continue;
    await prisma.leadSource.create({ data: { code, name, sortOrder: (index + 1) * 10 } });
    created += 1;
  }
  if (created) console.log(`  lead sources: +${created}`);
}

async function seedSuperAdmin() {
  const role = await prisma.role.findUniqueOrThrow({ where: { slug: "super-admin" } });
  const existing = await prisma.user.findFirst({ where: { roleId: role.id, deletedAt: null } });
  if (existing) return;

  const username = (process.env.SEED_ADMIN_USERNAME || "superadmin").toLowerCase();
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase() || null;
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const password = process.env.SEED_ADMIN_PASSWORD || generatePassword();

  await prisma.user.create({
    data: {
      username,
      email,
      passwordHash: await hashPassword(password),
      roleId: role.id,
      mustChangePassword: true,
    },
  });

  console.log(`  super admin: created "${username}"`);
  if (generated) {
    console.log(`  ┌──────────────────────────────────────────────────────────`);
    console.log(`  │ Generated password: ${password}`);
    console.log(`  │ Shown once. You must change it on first login.`);
    console.log(`  └──────────────────────────────────────────────────────────`);
  }
}

async function main() {
  console.log(`Seeding (client: ${clientName})`);

  await seedCompany();
  await seedOrganization();
  await seedLeadSources();

  const modules = await discoverModules();
  const catalog = buildCatalog(modules);
  const summary = await prisma.$transaction(
    (tx) => syncAccessControl(tx, { catalog, roles: systemRoles }),
    TX_OPTIONS,
  );
  console.log(
    `  access control: ${catalog.length} permissions in catalog, ` +
      `+${summary.permissionsCreated} / -${summary.permissionsRemoved} permissions, ` +
      `+${summary.rolesCreated} roles, +${summary.grantsCreated} grants`,
  );

  const approvals = await prisma.$transaction(
    (tx) => syncApprovalWorkflows(tx, { modules, chains: client.approvalChains }),
    TX_OPTIONS,
  );
  console.log(`  approval workflows: +${approvals.created}`);

  const accounts = await prisma.$transaction(
    (tx) => syncChartOfAccounts(tx, client.chartOfAccounts),
    TX_OPTIONS,
  );
  if (accounts) console.log(`  chart of accounts: +${accounts}`);

  await seedSuperAdmin();
  console.log("Seed complete");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

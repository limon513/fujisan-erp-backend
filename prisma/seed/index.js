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

const clientName = process.env.SEED_CLIENT || "fujisan";
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

  const catalog = buildCatalog(await discoverModules());
  const summary = await prisma.$transaction((tx) =>
    syncAccessControl(tx, { catalog, roles: systemRoles }),
  );
  console.log(
    `  access control: ${catalog.length} permissions in catalog, ` +
      `+${summary.permissionsCreated} / -${summary.permissionsRemoved} permissions, ` +
      `+${summary.rolesCreated} roles, +${summary.grantsCreated} grants`,
  );

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

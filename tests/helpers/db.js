import prisma from "#core/db/prisma.js";
import { clearPermissionCache } from "#core/auth/actor.js";
import { hashPassword } from "#core/utils/password.js";

/** Empties every application table in the test database. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  clearPermissionCache();
}

export const TEST_PASSWORD = "Passw0rd!";

// bcrypt is slow on purpose; hash the shared test password once
let testPasswordHash;

/** Creates a user (and its role if missing). */
export async function createUser({
  username = "tester",
  email = `${username}@example.com`,
  mobile = null,
  password = TEST_PASSWORD,
  roleSlug = "sales-executive",
  roleLevel = 30,
  status = "ACTIVE",
  mustChangePassword = false,
  employee = null,
} = {}) {
  const role = await prisma.role.upsert({
    where: { slug: roleSlug },
    update: {},
    create: { slug: roleSlug, name: roleSlug, level: roleLevel, isSystem: true },
  });

  let passwordHash;
  if (password === TEST_PASSWORD) {
    testPasswordHash ??= await hashPassword(TEST_PASSWORD);
    passwordHash = testPasswordHash;
  } else {
    passwordHash = await hashPassword(password);
  }

  return prisma.user.create({
    data: {
      username,
      email,
      mobile,
      passwordHash,
      roleId: role.id,
      status,
      mustChangePassword,
      employeeId: employee?.id ?? null,
    },
  });
}

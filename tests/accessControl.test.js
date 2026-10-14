import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "#core/db/prisma.js";
import { definePermissions } from "#core/rbac/permissions.js";
import { buildCatalog, syncAccessControl } from "../prisma/seed/core/accessControl.js";

const roles = [
  { slug: "boss", name: "Boss", level: 90, template: [["*", "ALL"]] },
  {
    slug: "seller",
    name: "Seller",
    level: 30,
    template: [
      ["lead.*", "OWN"],
      ["lead.delete", null],
    ],
  },
];

const leadModule = {
  name: "lead",
  permissions: definePermissions({ module: "lead", label: "Leads" }),
};
const settingModule = {
  name: "setting",
  permissions: definePermissions({
    module: "setting",
    label: "Settings",
    actions: ["view", "edit"],
    scoped: false,
  }),
};

const sync = (modules) =>
  prisma.$transaction((tx) => syncAccessControl(tx, { catalog: buildCatalog(modules), roles }));

const grantsOf = async (slug) => {
  const rows = await prisma.rolePermission.findMany({
    where: { role: { slug } },
    include: { permission: true },
  });
  return Object.fromEntries(rows.map((r) => [r.permission.key, r.scope]).sort());
};

beforeEach(async () => {
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("syncAccessControl", () => {
  it("creates roles and applies templates to the catalog", async () => {
    const summary = await sync([leadModule, settingModule]);
    expect(summary).toMatchObject({ permissionsCreated: 6, rolesCreated: 2 });
    expect(await grantsOf("seller")).toEqual({
      "lead.create": "OWN",
      "lead.edit": "OWN",
      "lead.view": "OWN",
    });
    expect(Object.keys(await grantsOf("boss"))).toHaveLength(6);
  });

  it("is idempotent", async () => {
    await sync([leadModule]);
    const second = await sync([leadModule]);
    expect(second).toEqual({
      permissionsCreated: 0,
      permissionsRemoved: 0,
      rolesCreated: 0,
      grantsCreated: 0,
    });
  });

  it("keeps manual edits and grants only new permissions on re-sync", async () => {
    await sync([leadModule]);
    const seller = await prisma.role.findUniqueOrThrow({ where: { slug: "seller" } });
    const leadEdit = await prisma.permission.findUniqueOrThrow({ where: { key: "lead.edit" } });
    // admin revokes lead.edit and widens lead.view to TEAM in the matrix UI
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: seller.id, permissionId: leadEdit.id } },
    });
    const leadView = await prisma.permission.findUniqueOrThrow({ where: { key: "lead.view" } });
    await prisma.rolePermission.update({
      where: { roleId_permissionId: { roleId: seller.id, permissionId: leadView.id } },
      data: { scope: "TEAM" },
    });

    const leadWithExport = {
      name: "lead",
      permissions: definePermissions({
        module: "lead",
        label: "Leads",
        actions: ["view", "create", "edit", "delete", "export"],
      }),
    };
    const summary = await sync([leadWithExport]);

    expect(summary.permissionsCreated).toBe(1);
    expect(await grantsOf("seller")).toEqual({
      "lead.create": "OWN",
      "lead.export": "OWN",
      "lead.view": "TEAM",
    });
    const updatedSeller = await prisma.role.findUniqueOrThrow({ where: { slug: "seller" } });
    expect(updatedSeller.permissionsVersion).toBe(seller.permissionsVersion + 1);
  });

  it("removes permissions no module declares anymore", async () => {
    await sync([leadModule, settingModule]);
    const summary = await sync([leadModule]);
    expect(summary.permissionsRemoved).toBe(2);
    expect(await prisma.permission.count({ where: { module: "setting" } })).toBe(0);
  });

  it("rejects a key declared by two modules", () => {
    const clash = {
      name: "crm",
      permissions: definePermissions({ module: "crm", resource: "lead", label: "L" }),
    };
    expect(() => buildCatalog([leadModule, clash])).toThrow(/declared by both/);
  });
});

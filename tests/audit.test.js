import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const logsFor = (entityType) =>
  prisma.auditLog.findMany({ where: { entityType }, orderBy: { createdAt: "asc" } });

describe("automatic capture", () => {
  it("records create, update and delete with old/new values", async () => {
    const branch = await prisma.branch.create({ data: { code: "DHK", name: "Dhaka" } });
    await prisma.branch.update({ where: { id: branch.id }, data: { name: "Dhaka North" } });
    await prisma.branch.delete({ where: { id: branch.id } });

    const [created, updated, deleted] = await logsFor("Branch");
    expect(created).toMatchObject({
      action: "CREATE",
      entityId: branch.id,
      description: 'Created Branch "Dhaka"',
    });
    expect(created.newValues).toMatchObject({ code: "DHK", name: "Dhaka" });

    expect(updated).toMatchObject({ action: "UPDATE", changedFields: ["name"] });
    expect(updated.oldValues).toEqual({ name: "Dhaka" });
    expect(updated.newValues).toEqual({ name: "Dhaka North" });

    expect(deleted).toMatchObject({
      action: "DELETE",
      description: 'Deleted Branch "Dhaka North"',
    });
    expect(deleted.oldValues).toMatchObject({ code: "DHK" });
  });

  it("skips writes that only touch ignored fields", async () => {
    const branch = await prisma.branch.create({ data: { code: "CTG", name: "Chattogram" } });
    await prisma.branch.update({ where: { id: branch.id }, data: { updatedById: branch.id } });
    await prisma.branch.update({ where: { id: branch.id }, data: { name: "Chattogram" } });
    expect((await logsFor("Branch")).map((l) => l.action)).toEqual(["CREATE"]);
  });

  it("captures changes made inside an interactive transaction", async () => {
    const branch = await prisma.branch.create({ data: { code: "SYL", name: "Sylhet" } });
    await prisma.$transaction(async (tx) => {
      await tx.branch.update({ where: { id: branch.id }, data: { phone: "01700000000" } });
    });
    const update = (await logsFor("Branch")).find((l) => l.action === "UPDATE");
    expect(update.newValues).toEqual({ phone: "01700000000" });
  });

  it("captures writes that use select", async () => {
    const branch = await prisma.branch.create({
      data: { code: "RAJ", name: "Rajshahi" },
      select: { id: true },
    });
    await prisma.branch.update({
      where: { id: branch.id },
      data: { name: "Rajshahi HQ" },
      select: { id: true },
    });
    const [created, updated] = await logsFor("Branch");
    expect(created.newValues).toMatchObject({ name: "Rajshahi" });
    expect(updated.newValues).toEqual({ name: "Rajshahi HQ" });
  });

  it("redacts secrets and ignores sign-in bookkeeping", async () => {
    const user = await createUser({ username: "secretive" });
    const [created] = await logsFor("User");
    expect(created.newValues.passwordHash).toBe("[redacted]");

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 2 },
    });
    expect(await prisma.auditLog.count({ where: { entityType: "User", action: "UPDATE" } })).toBe(
      0,
    );
  });

  it("does not audit unlisted models", async () => {
    await createUser();
    await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "tester", password: "Passw0rd!" });
    expect(
      await prisma.auditLog.count({ where: { entityType: { in: ["Session", "LoginHistory"] } } }),
    ).toBe(0);
  });
});

describe("audit log API", () => {
  let auditor;
  let admin;

  beforeEach(async () => {
    await seedAccessControl();
    await createUser({ username: "root", roleSlug: "super-admin" });
    await createUser({ username: "auditor", roleSlug: "auditor" });
    await createUser({ username: "seller", roleSlug: "sales-executive" });
    admin = await authHeader(request, app, "root");
    auditor = await authHeader(request, app, "auditor");
  });

  it("is limited to audit-log.view", async () => {
    const seller = await authHeader(request, app, "seller");
    expect((await request(app).get("/api/v1/audit-logs").set(seller)).status).toBe(403);
    expect((await request(app).get("/api/v1/audit-logs").set(auditor)).status).toBe(200);
  });

  it("attributes API changes to the signed-in user with IP", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: "viewer" } });
    await request(app).patch(`/api/v1/roles/${role.id}`).set(admin).send({ name: "Read Only" });

    const res = await request(app)
      .get("/api/v1/audit-logs?entityType=Role&action=UPDATE")
      .set(auditor);
    expect(res.body.meta.total).toBe(1);
    const [entry] = res.body.data;
    expect(entry).toMatchObject({
      entityId: role.id,
      changedFields: ["name"],
      user: { username: "root" },
    });
    expect(entry.ip).toBeTruthy();

    const detail = await request(app).get(`/api/v1/audit-logs/${entry.id}`).set(auditor);
    expect(detail.body.data).toMatchObject({
      oldValues: { name: "Viewer" },
      newValues: { name: "Read Only" },
    });
    expect(detail.body.data.requestId).toBeTruthy();
  });

  it("filters by user, search and date range, and lists filter options", async () => {
    const root = await prisma.user.findUniqueOrThrow({ where: { username: "root" } });
    const byUser = await request(app)
      .get(`/api/v1/audit-logs?userId=${root.id}&action=LOGIN`)
      .set(auditor);
    expect(byUser.body.meta.total).toBe(1);

    const search = await request(app).get("/api/v1/audit-logs?search=auditor").set(auditor);
    expect(search.body.data.every((e) => e.description.toLowerCase().includes("auditor"))).toBe(
      true,
    );

    const future = await request(app).get("/api/v1/audit-logs?from=2999-01-01").set(auditor);
    expect(future.body.meta.total).toBe(0);
    const badRange = await request(app)
      .get("/api/v1/audit-logs?from=2026-10-10&to=2026-10-01")
      .set(auditor);
    expect(badRange.status).toBe(400);

    const options = await request(app).get("/api/v1/audit-logs/filter-options").set(auditor);
    expect(options.body.data.entityTypes).toEqual(expect.arrayContaining(["User", "Role"]));
    expect(options.body.data.actions).toEqual(expect.arrayContaining(["CREATE", "LOGIN"]));
  });
});

import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let admin; // Super Admin
let hr; // HR Manager: role.view only

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await createUser({ username: "root", roleSlug: "super-admin" });
  await createUser({ username: "hrmanager", roleSlug: "hr-manager" });
  await createUser({ username: "seller", roleSlug: "sales-executive" });
  admin = await authHeader(request, app, "root");
  hr = await authHeader(request, app, "hrmanager");
});

afterAll(async () => {
  await prisma.$disconnect();
});

const roleBySlug = (slug) => prisma.role.findUniqueOrThrow({ where: { slug } });

/** A non-Super-Admin role manager at level 70 holding role.view/create/edit (not delete). */
async function roleManager() {
  const role = await prisma.role.create({
    data: { name: "Admin Lead", slug: "admin-lead", level: 70 },
  });
  const permissions = await prisma.permission.findMany({
    where: { key: { in: ["role.view", "role.create", "role.edit", "dashboard.view"] } },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id, scope: "ALL" })),
  });
  await createUser({ username: "lead", roleSlug: "admin-lead" });
  return authHeader(request, app, "lead");
}

describe("access", () => {
  it("requires authentication and the right permission", async () => {
    expect((await request(app).get("/api/v1/roles")).status).toBe(401);
    const seller = await authHeader(request, app, "seller");
    expect((await request(app).get("/api/v1/roles").set(seller)).status).toBe(403);
  });

  it("lets HR view but not change roles", async () => {
    const list = await request(app).get("/api/v1/roles?limit=50&sortBy=level").set(hr);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(21);
    expect(list.body.data[0]).toMatchObject({ slug: "super-admin", userCount: 1 });

    const create = await request(app).post("/api/v1/roles").set(hr).send({ name: "X", level: 10 });
    expect(create.status).toBe(403);
  });

  it("exposes the permission catalog grouped by module", async () => {
    const res = await request(app).get("/api/v1/roles/permission-catalog").set(hr);
    const roleModule = res.body.data.find((m) => m.module === "role");
    expect(roleModule.permissions.map((p) => p.key)).toEqual([
      "role.view",
      "role.create",
      "role.edit",
      "role.delete",
    ]);
  });
});

describe("role CRUD", () => {
  it("creates a role, optionally copying permissions", async () => {
    const source = await roleBySlug("hr-manager");
    const res = await request(app)
      .post("/api/v1/roles")
      .set(admin)
      .send({ name: "HR Assistant", level: 35, copyFromRoleId: source.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ slug: "hr-assistant", isSystem: false, level: 35 });
    expect(res.body.data.permissions).toMatchObject({ "role.view": "ALL" });

    const duplicate = await request(app)
      .post("/api/v1/roles")
      .set(admin)
      .send({ name: "hr assistant", level: 30 });
    expect(duplicate.status).toBe(409);

    const reserved = await request(app)
      .post("/api/v1/roles")
      .set(admin)
      .send({ name: "Too High", level: 100 });
    expect(reserved.status).toBe(400);
  });

  it("keeps the slug when a role is renamed", async () => {
    const role = await roleBySlug("viewer");
    const res = await request(app)
      .patch(`/api/v1/roles/${role.id}`)
      .set(admin)
      .send({ name: "Read Only" });
    expect(res.body.data).toMatchObject({ name: "Read Only", slug: "viewer" });
    expect(await prisma.auditLog.count({ where: { entityType: "Role", action: "UPDATE" } })).toBe(
      1,
    );
  });

  it("protects system roles and roles in use from deletion", async () => {
    const system = await roleBySlug("viewer");
    expect((await request(app).delete(`/api/v1/roles/${system.id}`).set(admin)).status).toBe(422);

    const custom = await request(app)
      .post("/api/v1/roles")
      .set(admin)
      .send({ name: "Temp", level: 5 });
    const id = custom.body.data.id;
    await prisma.user.update({ where: { username: "seller" }, data: { roleId: id } });
    expect((await request(app).delete(`/api/v1/roles/${id}`).set(admin)).status).toBe(409);

    await prisma.user.update({
      where: { username: "seller" },
      data: { roleId: (await roleBySlug("sales-executive")).id },
    });
    expect((await request(app).delete(`/api/v1/roles/${id}`).set(admin)).status).toBe(200);
  });
});

describe("permissions", () => {
  it("replaces a role's permissions and validates keys", async () => {
    const role = await roleBySlug("viewer");
    const res = await request(app)
      .put(`/api/v1/roles/${role.id}/permissions`)
      .set(admin)
      .send({ permissions: [{ key: "role.view", scope: "TEAM" }] });
    expect(res.status).toBe(200);
    // role.* is unscoped, so the scope is stored as ALL
    expect(res.body.data.permissions).toEqual({ "role.view": "ALL" });
    expect(res.body.data.permissionsVersion).toBe(role.permissionsVersion + 1);

    const unknown = await request(app)
      .put(`/api/v1/roles/${role.id}/permissions`)
      .set(admin)
      .send({ permissions: [{ key: "nope.view", scope: "ALL" }] });
    expect(unknown.status).toBe(400);
  });

  it("never edits the Super Admin role", async () => {
    const role = await roleBySlug("super-admin");
    const res = await request(app)
      .put(`/api/v1/roles/${role.id}/permissions`)
      .set(admin)
      .send({ permissions: [] });
    expect(res.status).toBe(422);
  });

  it("applies to signed-in users on their next request", async () => {
    const seller = await authHeader(request, app, "seller");
    expect((await request(app).get("/api/v1/roles").set(seller)).status).toBe(403);

    const role = await roleBySlug("sales-executive");
    const current = await request(app).get(`/api/v1/roles/${role.id}`).set(admin);
    const permissions = Object.entries(current.body.data.permissions).map(([key, scope]) => ({
      key,
      scope,
    }));
    await request(app)
      .put(`/api/v1/roles/${role.id}/permissions`)
      .set(admin)
      .send({ permissions: [...permissions, { key: "role.view", scope: "ALL" }] });

    expect((await request(app).get("/api/v1/roles").set(seller)).status).toBe(200);
  });
});

describe("privilege escalation", () => {
  it("only manages roles below your own level", async () => {
    const lead = await roleManager();
    const above = await roleBySlug("gm-dgm"); // level 80
    expect(
      (await request(app).patch(`/api/v1/roles/${above.id}`).set(lead).send({ name: "Boss" }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).post("/api/v1/roles").set(lead).send({ name: "Peer", level: 70 })).status,
    ).toBe(403);

    const below = await roleBySlug("team-leader"); // level 50
    expect(
      (await request(app).patch(`/api/v1/roles/${below.id}`).set(lead).send({ level: 75 })).status,
    ).toBe(403);
    expect(
      (await request(app).patch(`/api/v1/roles/${below.id}`).set(lead).send({ level: 55 })).status,
    ).toBe(200);
  });

  it("can't grant permissions you don't hold, but can remove them", async () => {
    const lead = await roleManager();
    const created = await request(app)
      .post("/api/v1/roles")
      .set(admin)
      .send({ name: "Junior", level: 20 });
    const id = created.body.data.id;

    const escalate = await request(app)
      .put(`/api/v1/roles/${id}/permissions`)
      .set(lead)
      .send({ permissions: [{ key: "role.delete", scope: "ALL" }] });
    expect(escalate.status).toBe(403);
    expect(escalate.body.errors[0].path).toBe("role.delete");

    // Super Admin grants it; the lead may keep it unchanged or remove it
    await request(app)
      .put(`/api/v1/roles/${id}/permissions`)
      .set(admin)
      .send({ permissions: [{ key: "role.delete", scope: "ALL" }] });
    const keep = await request(app)
      .put(`/api/v1/roles/${id}/permissions`)
      .set(lead)
      .send({
        permissions: [
          { key: "role.delete", scope: "ALL" },
          { key: "role.view", scope: "ALL" },
        ],
      });
    expect(keep.status).toBe(200);
    const remove = await request(app)
      .put(`/api/v1/roles/${id}/permissions`)
      .set(lead)
      .send({ permissions: [] });
    expect(remove.status).toBe(200);
    expect(remove.body.data.permissions).toEqual({});
  });
});

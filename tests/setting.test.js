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
  await seedAccessControl();
  await prisma.company.create({ data: { name: "Fujisan Properties Ltd." } });
  await createUser({ username: "root", roleSlug: "super-admin" });
  await createUser({ username: "viewer", roleSlug: "viewer" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("settings", () => {
  it("exposes public branding without signing in", async () => {
    const res = await request(app).get("/api/v1/settings/branding");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ companyName: "Fujisan Properties Ltd." });
  });

  it("lets any signed-in user read the company profile but only setting.edit change it", async () => {
    const viewer = await authHeader(request, app, "viewer");
    const read = await request(app).get("/api/v1/settings/company").set(viewer);
    expect(read.body.data).toMatchObject({
      currency: "BDT",
      timezone: "Asia/Dhaka",
      fiscalYearStartMonth: 7,
    });
    expect((await request(app).get("/api/v1/settings/company")).status).toBe(401);

    const denied = await request(app)
      .patch("/api/v1/settings/company")
      .set(viewer)
      .send({ name: "X Ltd" });
    expect(denied.status).toBe(403);
  });

  it("validates and saves company details, with an audit entry", async () => {
    const admin = await authHeader(request, app, "root");
    const bad = await request(app)
      .patch("/api/v1/settings/company")
      .set(admin)
      .send({ tin: "123" });
    expect(bad.status).toBe(400);

    const res = await request(app).patch("/api/v1/settings/company").set(admin).send({
      tin: "123456789012",
      phone: "02-9876543",
      website: "https://fujisan.example",
      email: "",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tin: "123456789012", phone: "02-9876543", email: null });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Company", action: "UPDATE" },
    });
    expect(audit.changedFields.sort()).toEqual(["phone", "tin", "website"]);
  });
});

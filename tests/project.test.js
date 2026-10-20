import { rm } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

// 2×3 px PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGP4z8DAwMDAxMDAAAAeLwIEXYCmfwAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

let app;
let admin;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await createUser({ username: "root", roleSlug: "super-admin" });
  await createUser({ username: "seller", roleSlug: "sales-executive" });
  admin = await authHeader(request, app, "root");
});

afterAll(async () => {
  await rm(".test-storage", { recursive: true, force: true });
  await prisma.$disconnect();
});

const createProject = (body = {}) =>
  request(app)
    .post("/api/v1/projects")
    .set(admin)
    .send({
      code: "fcity",
      name: "Fujisan City",
      landAreaDecimal: "1250.5",
      district: "Dhaka",
      ...body,
    });

describe("projects", () => {
  it("creates a project with plot counts and rejects duplicate codes", async () => {
    const res = await createProject();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: "FCITY",
      status: "ONGOING",
      landAreaDecimal: "1250.5",
      defaultHoldDays: 7,
      plots: { AVAILABLE: 0, total: 0 },
      layout: null,
    });
    expect((await createProject()).status).toBe(409);
  });

  it("lets sales view projects but not change them", async () => {
    await createProject();
    const seller = await authHeader(request, app, "seller");
    expect((await request(app).get("/api/v1/projects").set(seller)).status).toBe(200);
    expect(
      (await request(app).post("/api/v1/projects").set(seller).send({ code: "X", name: "X" }))
        .status,
    ).toBe(403);
  });

  it("manages blocks and roads without resetting fields on partial updates", async () => {
    const project = (await createProject()).body.data;
    const base = `/api/v1/projects/${project.id}`;

    const block = await request(app)
      .post(`${base}/blocks`)
      .set(admin)
      .send({ code: "a", name: "Block A", sortOrder: 2 });
    expect(block.status).toBe(201);
    expect(block.body.data).toMatchObject({ code: "A", sortOrder: 2, isActive: true });
    expect(
      (await request(app).post(`${base}/blocks`).set(admin).send({ code: "A", name: "Again" }))
        .status,
    ).toBe(409);

    await request(app)
      .patch(`${base}/blocks/${block.body.data.id}`)
      .set(admin)
      .send({ isActive: false });
    const renamed = await request(app)
      .patch(`${base}/blocks/${block.body.data.id}`)
      .set(admin)
      .send({ name: "Block Alpha" });
    expect(renamed.body.data).toMatchObject({ name: "Block Alpha", sortOrder: 2, isActive: false });

    const road = await request(app)
      .post(`${base}/roads`)
      .set(admin)
      .send({ name: "Road 1", widthFeet: 25 });
    expect(road.body.data.widthFeet).toBe("25");

    const blocks = await request(app).get(`${base}/blocks`).set(admin);
    expect(blocks.body.data).toHaveLength(1);
    expect(blocks.body.data[0].plotCount).toBe(0);
  });

  it("sets an image layout and records its size as the map space", async () => {
    const project = (await createProject()).body.data;
    const image = await request(app)
      .post("/api/v1/files")
      .set(admin)
      .attach("file", PNG, "plan.png")
      .field("category", "LAYOUT");
    const pdf = await request(app).post("/api/v1/files").set(admin).attach("file", PDF, "plan.pdf");

    const wrong = await request(app)
      .put(`/api/v1/projects/${project.id}/layout`)
      .set(admin)
      .send({ fileId: pdf.body.data.id });
    expect(wrong.status).toBe(422);

    const res = await request(app)
      .put(`/api/v1/projects/${project.id}/layout`)
      .set(admin)
      .send({ fileId: image.body.data.id });
    expect(res.body.data.layout).toMatchObject({ fileId: image.body.data.id, width: 2, height: 3 });
    expect((await request(app).get(res.body.data.layout.url)).status).toBe(200);
    expect((await prisma.file.findUnique({ where: { id: image.body.data.id } })).entityId).toBe(
      project.id,
    );
  });

  it("counts plots by status and protects projects that have plots", async () => {
    const project = (await createProject()).body.data;
    const block = await prisma.block.create({
      data: { projectId: project.id, code: "A", name: "Block A" },
    });
    const plot = (n, status = "AVAILABLE") => ({
      projectId: project.id,
      blockId: block.id,
      plotNumber: String(n),
      code: `A-${n}`,
      areaSqft: 1440,
      price: 4800000,
      status,
    });
    await prisma.plot.createMany({ data: [plot(1), plot(2), plot(3, "SOLD")] });

    const res = await request(app).get(`/api/v1/projects/${project.id}`).set(admin);
    expect(res.body.data.plots).toMatchObject({ AVAILABLE: 2, SOLD: 1, total: 3 });

    expect((await request(app).delete(`/api/v1/projects/${project.id}`).set(admin)).status).toBe(
      409,
    );
    expect(
      (await request(app).delete(`/api/v1/projects/${project.id}/blocks/${block.id}`).set(admin))
        .status,
    ).toBe(409);
  });

  it("rejects a second active hold on the same plot at the database level", async () => {
    const project = (await createProject()).body.data;
    const block = await prisma.block.create({
      data: { projectId: project.id, code: "A", name: "A" },
    });
    const plot = await prisma.plot.create({
      data: {
        projectId: project.id,
        blockId: block.id,
        plotNumber: "1",
        code: "A-1",
        areaSqft: 1000,
        price: 1,
      },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeCode: "E1",
        fullName: "Seller",
        mobile: "8801711000000",
        joiningDate: new Date("2026-01-01"),
        branch: { create: { code: "HO", name: "HO" } },
        department: { create: { code: "S", name: "Sales" } },
        designation: { create: { name: "Exec" } },
      },
    });
    const root = await prisma.user.findUniqueOrThrow({ where: { username: "root" } });
    const hold = {
      plotId: plot.id,
      requestedById: employee.id,
      heldById: root.id,
      reason: "Customer visiting",
      days: 3,
      expiresAt: new Date(Date.now() + 3 * 86400000),
    };
    await prisma.plotHold.create({ data: hold });
    await expect(prisma.plotHold.create({ data: hold })).rejects.toMatchObject({ code: "P2002" });
  });
});

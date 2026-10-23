import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { startOfDhakaMonth } from "#modules/dashboard/dashboard.service.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("dashboard", () => {
  it("starts the month in Dhaka time", () => {
    // 1 Nov 01:00 in Dhaka is still 31 Oct in UTC
    expect(startOfDhakaMonth(new Date("2026-10-31T19:00:00Z")).toISOString()).toBe(
      "2026-10-31T18:00:00.000Z",
    );
    expect(startOfDhakaMonth(new Date("2026-10-31T17:00:00Z")).toISOString()).toBe(
      "2026-09-30T18:00:00.000Z",
    );
  });

  it("shows each role only what it may see", async () => {
    const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
    const department = await prisma.department.create({ data: { code: "S", name: "Sales" } });
    const designation = await prisma.designation.create({ data: { name: "Exec" } });
    const seller = await prisma.employee.create({
      data: {
        employeeCode: "E1",
        fullName: "Rahim",
        mobile: "8801711000001",
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: department.id,
        designationId: designation.id,
      },
    });
    await createUser({ username: "root", roleSlug: "super-admin" });
    await createUser({ username: "seller", roleSlug: "sales-executive", employee: seller });
    await createUser({ username: "viewer", roleSlug: "viewer" });

    const project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
    const block = await prisma.block.create({
      data: { projectId: project.id, code: "A", name: "A" },
    });
    const plot = (n, status = "AVAILABLE") => ({
      projectId: project.id,
      blockId: block.id,
      plotNumber: String(n),
      code: `A-${n}`,
      areaSqft: 1440,
      price: 1000000,
      status,
    });
    await prisma.plot.createMany({ data: [plot(1), plot(2), plot(3, "SOLD"), plot(4, "HOLD")] });
    const held = await prisma.plot.findFirst({ where: { code: "A-4" } });
    const root = await prisma.user.findUniqueOrThrow({ where: { username: "root" } });
    await prisma.plotHold.create({
      data: {
        plotId: held.id,
        requestedById: seller.id,
        heldById: root.id,
        reason: "Visit",
        days: 1,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.customer.create({
      data: {
        customerCode: "C1",
        fullName: "Mine",
        mobile: "8801811000001",
        ownerId: seller.id,
        branchId: branch.id,
        departmentId: department.id,
      },
    });
    await prisma.customer.create({
      data: { customerCode: "C2", fullName: "Not mine", mobile: "8801811000002" },
    });

    const admin = await request(app)
      .get("/api/v1/dashboard/summary")
      .set(await authHeader(request, app, "root"));
    expect(admin.body.data.inventory).toMatchObject({
      totals: { AVAILABLE: 2, SOLD: 1, HOLD: 1, total: 4 },
      availableValue: "2000000",
      activeHolds: 1,
    });
    expect(admin.body.data.inventory.projects[0]).toMatchObject({
      name: "Fujisan City",
      plots: { total: 4 },
    });
    expect(admin.body.data.expiringHolds[0]).toMatchObject({
      plot: { code: "A-4" },
      requestedBy: { fullName: "Rahim" },
    });
    expect(admin.body.data.customers).toMatchObject({ total: 2, scope: "ALL" });
    expect(admin.body.data.people.activeEmployees).toBe(1);

    const mine = await request(app)
      .get("/api/v1/dashboard/summary")
      .set(await authHeader(request, app, "seller"));
    expect(mine.body.data.customers).toMatchObject({ total: 1, newThisMonth: 1, scope: "OWN" });
    expect(mine.body.data.myHolds.map((h) => h.plot.code)).toEqual(["A-4"]);
    expect(mine.body.data.inventory.totals.total).toBe(4);
    expect(mine.body.data.people).toBeUndefined();

    const viewer = await request(app)
      .get("/api/v1/dashboard/summary")
      .set(await authHeader(request, app, "viewer"));
    expect(viewer.status).toBe(200);
    expect(Object.keys(viewer.body.data)).toEqual(["generatedAt"]);
  });
});

import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let admin;
let project;
let blockA;
let road;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await createUser({ username: "root", roleSlug: "super-admin" });
  await createUser({ username: "seller", roleSlug: "sales-executive" });
  admin = await authHeader(request, app, "root");
  project = await prisma.project.create({ data: { code: "FCITY", name: "Fujisan City" } });
  blockA = await prisma.block.create({
    data: { projectId: project.id, code: "A", name: "Block A" },
  });
  road = await prisma.road.create({ data: { projectId: project.id, name: "Road 1" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const createPlot = (body = {}) =>
  request(app)
    .post("/api/v1/plots")
    .set(admin)
    .send({
      projectId: project.id,
      blockId: blockA.id,
      roadId: road.id,
      plotNumber: "1",
      areaSqft: 1440,
      price: 4800000,
      facing: "NORTH",
      ...body,
    });

describe("plots", () => {
  it("creates a plot with code, rate per sqft and initial history", async () => {
    const res = await createPlot();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: "A-1",
      areaSqft: "1440",
      price: "4800000",
      ratePerSqft: "3333.33",
      status: "AVAILABLE",
      block: { code: "A" },
      road: { name: "Road 1" },
      activeHold: null,
    });
    expect(res.body.data.statusHistory).toHaveLength(1);
    expect(res.body.data.priceHistory[0]).toMatchObject({ newPrice: "4800000", oldPrice: null });

    expect((await createPlot()).status).toBe(409);
    const other = await prisma.project.create({ data: { code: "OTHER", name: "Other" } });
    expect((await createPlot({ projectId: other.id, plotNumber: "9" })).status).toBe(422);
    expect((await createPlot({ plotNumber: "2", price: 10.555 })).status).toBe(400);
  });

  it("renumbers, locks booked plots, and changes price with a reason", async () => {
    const plot = (await createPlot()).body.data;
    const renamed = await request(app)
      .patch(`/api/v1/plots/${plot.id}`)
      .set(admin)
      .send({ plotNumber: "101" });
    expect(renamed.body.data.code).toBe("A-101");

    const seller = await authHeader(request, app, "seller");
    expect(
      (
        await request(app)
          .post(`/api/v1/plots/${plot.id}/price`)
          .set(seller)
          .send({ price: 1, reason: "test" })
      ).status,
    ).toBe(403);

    const priced = await request(app)
      .post(`/api/v1/plots/${plot.id}/price`)
      .set(admin)
      .send({ price: 4650000, reason: "Festival offer" });
    expect(priced.body.data.price).toBe("4650000");
    expect(priced.body.data.priceHistory[0]).toMatchObject({
      oldPrice: "4800000",
      newPrice: "4650000",
      reason: "Festival offer",
    });
    expect(await prisma.auditLog.count({ where: { action: "PRICE_CHANGED" } })).toBe(1);

    await prisma.plot.update({ where: { id: plot.id }, data: { status: "BOOKED" } });
    expect(
      (await request(app).patch(`/api/v1/plots/${plot.id}`).set(admin).send({ areaSqft: 1500 }))
        .status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`/api/v1/plots/${plot.id}/price`)
          .set(admin)
          .send({ price: 1, reason: "nope" })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).patch(`/api/v1/plots/${plot.id}`).set(admin).send({ remarks: "Corner" }))
        .status,
    ).toBe(200);
  });

  it("only deletes plots that were never held", async () => {
    const plot = (await createPlot()).body.data;
    const booked = (await createPlot({ plotNumber: "2" })).body.data;
    await prisma.plot.update({ where: { id: booked.id }, data: { status: "BOOKED" } });
    expect((await request(app).delete(`/api/v1/plots/${booked.id}`).set(admin)).status).toBe(409);
    expect((await request(app).delete(`/api/v1/plots/${plot.id}`).set(admin)).status).toBe(200);
  });

  it("filters by status, price range and search", async () => {
    await createPlot({ plotNumber: "1", price: 3000000 });
    await createPlot({ plotNumber: "2", price: 5000000 });
    const held = (await createPlot({ plotNumber: "3", price: 7000000 })).body.data;
    await prisma.plot.update({ where: { id: held.id }, data: { status: "HOLD" } });

    const q = (qs) => request(app).get(`/api/v1/plots?projectId=${project.id}&${qs}`).set(admin);
    expect((await q("status=AVAILABLE")).body.meta.total).toBe(2);
    expect((await q("minPrice=4000000&maxPrice=8000000")).body.data.map((p) => p.code)).toEqual([
      "A-2",
      "A-3",
    ]);
    expect((await q("search=a-3")).body.data.map((p) => p.code)).toEqual(["A-3"]);
  });
});

describe("plot import", () => {
  const importFile = (buffer, name, dryRun = true) =>
    request(app)
      .post(`/api/v1/plots/import?projectId=${project.id}&dryRun=${dryRun}`)
      .set(admin)
      .attach("file", buffer, name);

  it("previews with row errors and saves nothing", async () => {
    await createPlot({ plotNumber: "1" });
    const csv = [
      "Block,Plot,Area (sqft),Price (BDT),Road,Facing",
      "A,1,1440,4800000,Road 1,N", // exists
      "A,2,abc,4800000,Road 1,N", // bad area
      "B,1,1440,4900000,Road 2,South-East",
      "B,1,1440,4900000,Road 2,S", // duplicate in file
      'C,"7",1200,"3,600,000",,upward', // unknown facing (and a quoted value)
    ].join("\n");
    const res = await importFile(Buffer.from(csv), "plots.csv");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      rows: 5,
      valid: 1,
      created: 0,
      newBlocks: ["B"],
      newRoads: ["Road 2"],
    });
    expect(res.body.data.errors.map((e) => e.row)).toEqual([2, 3, 5, 6]);
    expect(await prisma.plot.count()).toBe(1);

    const commit = await importFile(Buffer.from(csv), "plots.csv", false);
    expect(commit.status).toBe(422);
    expect(await prisma.plot.count()).toBe(1);
  });

  it("creates plots, blocks and roads from a CSV in one go", async () => {
    const csv =
      "Block,Plot,Area,Price,Road,Facing,Dimensions\nA,1,1440,4800000,Road 1,N,40 x 36 ft\nB,1,1800,6000000,Road 2,SW,\n";
    const res = await importFile(Buffer.from(csv), "plots.csv", false);
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);

    const plots = await prisma.plot.findMany({
      orderBy: { code: "asc" },
      include: { block: true, road: true },
    });
    expect(plots.map((p) => [p.code, p.block.code, p.road.name, p.facing])).toEqual([
      ["A-1", "A", "Road 1", "NORTH"],
      ["B-1", "B", "Road 2", "SOUTH_WEST"],
    ]);
    expect(await prisma.plotStatusHistory.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "PLOTS_IMPORTED" } })).toBe(1);
  });

  it("reads Excel files", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Plots");
    sheet.addRow(["Block", "Plot No", "Area sqft", "Price"]);
    sheet.addRow(["A", 5, 1440, 4800000]);
    sheet.addRow(["A", 6, 1440, { formula: "4800000+50000", result: 4850000 }]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const res = await importFile(buffer, "plots.xlsx", false);
    expect(res.status).toBe(201);
    const plot = await prisma.plot.findFirst({ where: { code: "A-6" } });
    expect(plot.price.toString()).toBe("4850000");
  });

  it("explains missing columns", async () => {
    const res = await importFile(Buffer.from("Plot,Price\n1,100\n"), "bad.csv");
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Missing column\(s\): block, areaSqft/);
  });
});

describe("plot holds", () => {
  let plot;
  let requester;
  let manager;

  beforeEach(async () => {
    plot = (await createPlot()).body.data;
    const org = {
      branch: { create: { code: "HO", name: "Head Office" } },
      department: { create: { code: "SALES", name: "Sales" } },
      designation: { create: { name: "Sales Executive" } },
    };
    requester = await prisma.employee.create({
      data: {
        employeeCode: "E1",
        fullName: "Rahim Uddin",
        mobile: "8801711000001",
        joiningDate: new Date("2026-01-01"),
        ...org,
      },
    });
    await createUser({ username: "rahim", roleSlug: "sales-executive", employee: requester });
    await createUser({ username: "manager", roleSlug: "sales-manager" });
    manager = await authHeader(request, app, "manager");
  });

  const act = (auth, action, body = {}) =>
    request(app).post(`/api/v1/plots/${plot.id}/${action}`).set(auth).send(body);

  it("lets Sales Manager and above hold, recording who asked", async () => {
    const seller = await authHeader(request, app, "seller");
    expect(
      (await act(seller, "hold", { requestedById: requester.id, reason: "Customer visit" })).status,
    ).toBe(403);

    expect(
      (await act(manager, "hold", { requestedById: plot.id, reason: "Customer visit" })).status,
    ).toBe(422);

    const res = await act(manager, "hold", {
      requestedById: requester.id,
      days: 3,
      reason: "Customer visiting on Friday",
      prospectName: "Karim",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "HOLD",
      activeHold: { requestedBy: { fullName: "Rahim Uddin" }, heldBy: { username: "manager" } },
    });
    const expiresIn = new Date(res.body.data.activeHold.expiresAt) - Date.now();
    expect(Math.round(expiresIn / 86400000)).toBe(3);
    expect(res.body.data.holdHistory[0]).toMatchObject({
      status: "ACTIVE",
      days: 3,
      prospectName: "Karim",
    });
    expect(res.body.data.statusHistory[0]).toMatchObject({
      refType: "HOLD",
      fromStatus: "AVAILABLE",
      toStatus: "HOLD",
    });

    // can't hold twice or block a held plot
    expect(
      (await act(manager, "hold", { requestedById: requester.id, reason: "Again" })).status,
    ).toBe(409);
    expect((await act(admin, "block", { reason: "Legal issue" })).status).toBe(409);
  });

  it("uses the project's default hold days", async () => {
    await prisma.project.update({ where: { id: project.id }, data: { defaultHoldDays: 5 } });
    const res = await act(manager, "hold", {
      requestedById: requester.id,
      reason: "Booking next week",
    });
    expect(res.body.data.holdHistory[0].days).toBe(5);
  });

  it("releases a hold manually and keeps it in history", async () => {
    await act(manager, "hold", { requestedById: requester.id, reason: "Customer visit" });
    const res = await act(manager, "release", { reason: "Customer chose another plot" });
    expect(res.body.data).toMatchObject({ status: "AVAILABLE", activeHold: null });
    expect(res.body.data.holdHistory[0]).toMatchObject({
      status: "RELEASED",
      releaseReason: "Customer chose another plot",
      releasedBy: { username: "manager" },
    });
    expect((await act(manager, "release", { reason: "Twice" })).status).toBe(409);
  });

  it("expires holds when the days run out and notifies both people", async () => {
    await act(manager, "hold", { requestedById: requester.id, days: 1, reason: "Customer visit" });
    await prisma.plotHold.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    // reading plots expires due holds even without the background job
    const list = await request(app).get(`/api/v1/plots?projectId=${project.id}`).set(admin);
    expect(list.body.data[0]).toMatchObject({ status: "AVAILABLE", activeHold: null });

    const detail = await request(app).get(`/api/v1/plots/${plot.id}`).set(admin);
    expect(detail.body.data.holdHistory[0]).toMatchObject({
      status: "EXPIRED",
      releaseReason: "Hold period of 1 day ended",
    });
    expect(detail.body.data.statusHistory[0]).toMatchObject({
      refType: "EXPIRY",
      toStatus: "AVAILABLE",
      changedById: null,
    });

    const notified = await prisma.notification.findMany({
      where: { type: "PLOT_HOLD_EXPIRED" },
      include: { user: true },
    });
    expect(notified.map((n) => n.user.username).sort()).toEqual(["manager", "rahim"]);
  });

  it("blocks and unblocks available plots", async () => {
    const blocked = await act(admin, "block", { reason: "Pending land dispute" });
    expect(blocked.body.data.status).toBe("BLOCKED");
    expect(
      (await act(manager, "hold", { requestedById: requester.id, reason: "x x x" })).status,
    ).toBe(409);
    const unblocked = await act(admin, "unblock", { reason: "Dispute resolved" });
    expect(unblocked.body.data.statusHistory.map((h) => h.refType).slice(0, 2)).toEqual([
      "UNBLOCK",
      "BLOCK",
    ]);
  });
});

describe("plot map", () => {
  it("saves outlines inside the layout and serves the map", async () => {
    const plot = (await createPlot()).body.data;
    await createPlot({ plotNumber: "2" });
    const square = {
      points: [
        [100, 50],
        [200, 50],
        [200, 150],
        [100, 150],
      ],
    };

    // no layout yet
    expect(
      (await request(app).put(`/api/v1/plots/${plot.id}/shape`).set(admin).send(square)).status,
    ).toBe(422);

    await prisma.project.update({
      where: { id: project.id },
      data: { layoutWidth: 1000, layoutHeight: 560 },
    });
    const outside = await request(app)
      .put(`/api/v1/plots/${plot.id}/shape`)
      .set(admin)
      .send({
        points: [
          [0, 0],
          [1200, 0],
          [0, 10],
        ],
      });
    expect(outside.status).toBe(422);
    expect(
      (
        await request(app)
          .put(`/api/v1/plots/${plot.id}/shape`)
          .set(admin)
          .send({
            points: [
              [0, 0],
              [1, 1],
            ],
          })
      ).status,
    ).toBe(400);

    const saved = await request(app).put(`/api/v1/plots/${plot.id}/shape`).set(admin).send(square);
    expect(saved.status).toBe(200);
    expect(saved.body.data.mapLabel).toEqual({ x: 150, y: 100 });

    const seller = await authHeader(request, app, "seller");
    expect(
      (await request(app).put(`/api/v1/plots/${plot.id}/shape`).set(seller).send(square)).status,
    ).toBe(403);

    const map = await request(app).get(`/api/v1/plots/map?projectId=${project.id}`).set(seller);
    expect(map.status).toBe(200);
    expect(map.body.data.counts).toMatchObject({ AVAILABLE: 2, total: 2, mapped: 1 });
    expect(map.body.data.plots[0]).toMatchObject({
      code: "A-1",
      mapShape: square,
      holdExpiresAt: null,
    });
    expect(map.body.data.plots[1].mapShape).toBeNull();

    const cleared = await request(app)
      .put(`/api/v1/plots/${plot.id}/shape`)
      .set(admin)
      .send({ points: null });
    expect(cleared.body.data.mapLabel).toBeNull();
  });
});

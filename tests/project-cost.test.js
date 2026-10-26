import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { discoverModules } from "../src/routes/index.js";
import { syncApprovalWorkflows } from "../prisma/seed/core/approvals.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let karim;
let plot;
let plan;
let project;
let plot8;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  await prisma.$transaction(async (tx) =>
    syncApprovalWorkflows(tx, {
      modules: await discoverModules(),
      chains: {
        BOOKING: [{ name: "Sales Manager", approverType: "ROLE", role: "sales-manager" }],
        CANCELLATION: [
          { name: "Sales Manager", approverType: "ROLE", role: "sales-manager" },
          { name: "Accounts Manager", approverType: "ROLE", role: "accounts-manager" },
        ],
      },
    }),
  );
  const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
  const sales = await prisma.department.create({ data: { code: "S", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Staff" } });
  let n = 0;
  const employee = (fullName) =>
    prisma.employee.create({
      data: {
        employeeCode: `E${++n}`,
        fullName,
        mobile: `88017110000${String(n).padStart(2, "0")}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: sales.id,
        designationId: designation.id,
      },
    });
  const seller = await employee("Rahim Seller");
  const users = {
    seller: await createUser({ username: "seller", roleSlug: "sales-executive", employee: seller }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: await employee("Selim Manager"),
    }),
    accountant: await createUser({ username: "accountant", roleSlug: "accountant" }),
    accounts: await createUser({ username: "accounts", roleSlug: "accounts-manager" }),
  };
  h = {};
  for (const name of Object.keys(users)) h[name] = await authHeader(request, app, name);

  project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
  const block = await prisma.block.create({
    data: { projectId: project.id, code: "A", name: "Block A" },
  });
  plot = await prisma.plot.create({
    data: {
      projectId: project.id,
      blockId: block.id,
      plotNumber: "7",
      code: "A-7",
      areaSqft: 1440,
      price: 4752000,
    },
  });
  plot8 = await prisma.plot.create({
    data: {
      projectId: project.id,
      blockId: block.id,
      plotNumber: "8",
      code: "A-8",
      areaSqft: 960,
      price: 3168000,
    },
  });
  karim = await prisma.customer.create({
    data: {
      customerCode: "CUS-000001",
      fullName: "Karim Ahmed",
      mobile: "8801811000001",
      ownerId: seller.id,
      branchId: branch.id,
    },
  });
  plan = await prisma.paymentPlan.create({
    data: {
      name: "24 months",
      downPaymentValue: 20,
      installmentCount: 24,
      cancellationChargeType: "PERCENT",
      cancellationChargeValue: 10,
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

const lines = async (sourceType, sourceId) => {
  const entry = await prisma.journalEntry.findFirst({
    where: { sourceType, sourceId },
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
  });
  return entry.lines.map((l) => [
    l.account.systemKey ?? l.account.code,
    Number(l.debit),
    Number(l.credit),
  ]);
};

const accountId = async (key) =>
  (await prisma.account.findUnique({ where: { systemKey: key } })).id;

async function registered(plotId) {
  const booking = (
    await api("post", "/bookings", "seller", {
      customerId: karim.id,
      plotId,
      paymentPlanId: plan.id,
    })
  ).body.data;
  await api("post", `/approvals/${booking.approval.id}/approve`, "manager", {});
  const res = await api("post", `/bookings/${booking.id}/register`, "manager", {});
  expect(res.status).toBe(200);
  return booking;
}

describe("project costs", () => {
  it("capitalises land costs and moves each plot's share to cost of sales on registration", async () => {
    const cost = (body) =>
      api("post", "/project-costs", "accountant", { projectId: project.id, ...body });
    const land = await cost({
      category: "LAND_PURCHASE",
      description: "Mouza Purbachal, dag 112–118",
      amount: 1200000,
      paidFromAccountId: await accountId("BANK"),
      reference: "PO-7",
    });
    expect(land.status).toBe(201);
    expect(land.body.data).toMatchObject({ inventoryAccount: { code: "1210" }, status: "POSTED" });
    await cost({
      category: "DEVELOPMENT",
      description: "Earth filling",
      amount: 480000,
      paidFromAccountId: await accountId("CASH"),
    });
    expect(
      (
        await cost({
          category: "OTHER",
          description: "Bad account",
          amount: 1,
          paidFromAccountId: await accountId("SALES_REVENUE"),
        })
      ).status,
    ).toBe(422);

    let summary = (await api("get", `/project-costs/summary?projectId=${project.id}`, "accounts"))
      .body.data;
    expect(summary).toMatchObject({
      totalCost: "1680000.00",
      costPerSqftUnsold: "700.00",
      area: { total: 2400, unsold: 2400 },
    });

    // A-7 is 1440 of 2400 sqft: 60% of each inventory account
    const a7 = await registered(plot.id);
    expect((await lines("Booking", a7.id)).slice(-3)).toEqual([
      ["COST_OF_SALES", 1008000, 0],
      ["LAND_COST", 0, 720000],
      ["DEVELOPMENT_COST", 0, 288000],
    ]);

    // A cost added later is carried by the plots still unsold; the last plot empties inventory
    await cost({
      category: "DEVELOPMENT",
      description: "Drainage",
      amount: 96000,
      paidFromAccountId: await accountId("CASH"),
    });
    const a8 = await registered(plot8.id);
    expect((await lines("Booking", a8.id)).slice(-3)).toEqual([
      ["COST_OF_SALES", 768000, 0],
      ["LAND_COST", 0, 480000],
      ["DEVELOPMENT_COST", 0, 288000],
    ]);
    summary = (await api("get", `/project-costs/summary?projectId=${project.id}`, "accounts")).body
      .data;
    expect(summary).toMatchObject({
      totalCost: "1776000.00",
      costOfSales: "1776000.00",
      inventoryLeft: "0.00",
      registered: { plots: 2, revenue: "7920000.00", grossProfit: "6144000.00", margin: 77.5 },
    });
    const tb = (await api("get", "/accounts/trial-balance", "accounts")).body.data;
    expect(tb.balanced).toBe(true);
  });

  it("reverses a mistaken cost once, by accounts managers only", async () => {
    const created = (
      await api("post", "/project-costs", "accountant", {
        projectId: project.id,
        category: "OTHER",
        description: "Survey fee entered twice",
        amount: 10000,
        paidFromAccountId: await accountId("CASH"),
      })
    ).body.data;
    expect(
      (
        await api("post", `/project-costs/${created.id}/reverse`, "accountant", {
          reason: "Duplicate",
        })
      ).status,
    ).toBe(403);
    const res = await api("post", `/project-costs/${created.id}/reverse`, "accounts", {
      reason: "Duplicate",
    });
    expect(res.body.data).toMatchObject({ status: "REVERSED", reverseReason: "Duplicate" });
    expect(
      (await api("post", `/project-costs/${created.id}/reverse`, "accounts", { reason: "Again" }))
        .status,
    ).toBe(409);
    const summary = (await api("get", `/project-costs/summary?projectId=${project.id}`, "accounts"))
      .body.data;
    expect(summary.totalCost).toBe("0.00");
    const list = (await api("get", `/project-costs?projectId=${project.id}`, "accountant")).body;
    expect(list.data).toHaveLength(1);
  });
});

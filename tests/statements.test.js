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

const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
      chains: { BOOKING: [{ name: "Sales Manager", approverType: "ROLE", role: "sales-manager" }] },
    }),
  );
  await prisma.company.create({ data: { name: "Fujisan Properties Ltd." } });
  const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
  const sales = await prisma.department.create({ data: { code: "S", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Staff" } });
  const seller = await prisma.employee.create({
    data: {
      employeeCode: "E1",
      fullName: "Rahim Seller",
      mobile: "8801711000001",
      joiningDate: new Date("2026-01-01"),
      branchId: branch.id,
      departmentId: sales.id,
      designationId: designation.id,
    },
  });
  const users = {
    seller: await createUser({ username: "seller", roleSlug: "sales-executive", employee: seller }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: await prisma.employee.create({
        data: {
          employeeCode: "E2",
          fullName: "Selim Manager",
          mobile: "8801711000002",
          joiningDate: new Date("2026-01-01"),
          branchId: branch.id,
          departmentId: sales.id,
          designationId: designation.id,
        },
      }),
    }),
    accountant: await createUser({ username: "accountant", roleSlug: "accountant" }),
    accounts: await createUser({ username: "accounts", roleSlug: "accounts-manager" }),
  };
  h = {};
  for (const name of Object.keys(users)) h[name] = await authHeader(request, app, name);

  const project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
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
      gracePeriodDays: 7,
      lateFeeValue: 500,
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

async function confirmedBooking(bookingDate = isoDay(0)) {
  const booking = (
    await api("post", "/bookings", "seller", {
      customerId: karim.id,
      plotId: plot.id,
      paymentPlanId: plan.id,
      bookingDate,
    })
  ).body.data;
  await api("post", `/approvals/${booking.approval.id}/approve`, "manager", {});
  return booking;
}

async function paid(booking, body = {}, verify = {}) {
  const payment = (
    await api("post", "/collections", "accountant", {
      bookingId: booking.id,
      amount: 1000000,
      method: "CASH",
      ...body,
    })
  ).body.data;
  const res = await api("post", `/collections/${payment.id}/verify`, "accounts", verify);
  return res;
}

const code = (c) => prisma.account.findUnique({ where: { code: c } }).then((a) => a.id);

async function journal(narration, debitCode, creditCode, amount) {
  const res = await api("post", "/journals", "accountant", {
    date: isoDay(0),
    narration,
    lines: [
      { accountId: await code(debitCode), debit: amount },
      { accountId: await code(creditCode), credit: amount },
    ],
  });
  expect(res.status).toBe(201);
}

describe("financial statements", () => {
  it("agree with each other on a small set of books", async () => {
    await journal("Share capital paid in", "1121", "3100", 10000000);
    await journal("Bank loan received", "1121", "2210", 5000000);
    await journal("Office computers", "1310", "1121", 200000);
    await journal("October rent", "5500", "1121", 85000);
    await journal("Cash withdrawn for the office", "1110", "1121", 50000);
    const booking = await confirmedBooking();
    await paid(booking); // ৳10,00,000 cash
    await api("post", "/project-costs", "accountant", {
      projectId: plot.projectId,
      category: "LAND_PURCHASE",
      description: "Land",
      amount: 1200000,
      paidFromAccountId: await code("1121"),
    });
    await api("post", `/bookings/${booking.id}/register`, "manager", {});

    const pl = (await api("get", "/accounts/profit-and-loss", "accounts")).body.data;
    expect(pl).toMatchObject({
      income: { total: "4752000.00" },
      expenses: { total: "1285000.00" },
      grossProfit: { sales: "4752000.00", costOfSales: "1200000.00", amount: "3552000.00" },
      netProfit: "3467000.00",
    });
    expect(pl.expenses.rows.map((r) => [r.code, r.depth, r.amount])).toEqual([
      ["5000", 0, "1285000.00"],
      ["5100", 1, "1200000.00"],
      ["5500", 1, "85000.00"],
    ]);

    const bs = (await api("get", "/accounts/balance-sheet", "accounts")).body.data;
    expect(bs).toMatchObject({
      assets: { total: "18467000.00" },
      liabilities: { total: "5000000.00" },
      equity: { total: "13467000.00" },
      liabilitiesAndEquity: "18467000.00",
      balanced: true,
    });
    expect(bs.equity.rows.at(-1)).toMatchObject({ id: "profit-year", amount: "3467000.00" });

    const cf = (await api("get", "/accounts/cash-flow", "accounts")).body.data;
    const section = (key) => cf.sections.find((s) => s.key === key);
    expect(section("OPERATING").rows.map((r) => [r.code, r.amount])).toEqual([
      ["1210", "-1200000.00"],
      ["2110", "1000000.00"],
      ["5500", "-85000.00"],
    ]);
    expect([section("INVESTING").total, section("FINANCING").total]).toEqual([
      "-200000.00",
      "15000000.00",
    ]);
    expect(cf).toMatchObject({
      netChange: "14515000.00",
      opening: "0.00",
      closing: "14515000.00",
      reconciles: true,
    });

    const cash = await code("1110");
    const book = (await api("get", `/accounts/cash-book?accountId=${cash}`, "accounts")).body.data;
    expect(book.accounts.find((a) => a.code === "1110")).toMatchObject({
      receipts: "1050000.00",
      payments: "0.00",
      closing: "1050000.00",
    });
    expect(book.lines.map((l) => [l.receipt, l.contra[0], l.balance])).toEqual([
      ["50000", "1121 Main bank account", "50000.00"],
      ["1000000", "2110 Customer advances (booking money and installments)", "1050000.00"],
    ]);
    expect(
      (await api("get", `/accounts/cash-book?accountId=${await code("5500")}`, "accounts")).status,
    ).toBe(422);
    const tb = (await api("get", "/accounts/trial-balance", "accounts")).body.data;
    expect(tb.balanced).toBe(true);
  });
});

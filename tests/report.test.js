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
        OWNERSHIP_TRANSFER: [
          { name: "Sales Manager", approverType: "ROLE", role: "sales-manager" },
          { name: "Accounts Manager", approverType: "ROLE", role: "accounts-manager" },
        ],
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
      cancellationChargeType: "PERCENT",
      cancellationChargeValue: 10,
      transferFeeType: "PERCENT",
      transferFeeValue: 1,
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

async function paidBooking(amount = 1000000, extra = {}) {
  const booking = (
    await api("post", "/bookings", "seller", {
      customerId: karim.id,
      plotId: plot.id,
      paymentPlanId: plan.id,
      ...extra,
    })
  ).body.data;
  await api("post", `/approvals/${booking.approval.id}/approve`, "manager", {});
  const payment = (
    await api("post", "/collections", "accountant", {
      bookingId: booking.id,
      amount,
      method: "CASH",
    })
  ).body.data;
  await api("post", `/collections/${payment.id}/verify`, "accounts", {});
  return booking;
}

describe("reports", () => {
  it("adds up sales, collections, receivables aging and the customer statement", async () => {
    const booking = await paidBooking();
    // Installment 1 (৳1,58,400, ৳49,600 of it paid) is 40 days late
    const today = new Date(
      `${new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10)}T00:00:00Z`,
    );
    await prisma.installment.updateMany({
      where: { bookingId: booking.id, number: 1 },
      data: { dueDate: new Date(today.getTime() - 40 * 864e5) },
    });

    const overview = (await api("get", "/reports/overview", "accounts")).body.data;
    expect(overview.thisMonth).toMatchObject({
      bookings: 1,
      booked: "4752000.00",
      collected: "1000000.00",
    });
    expect(overview.trend).toHaveLength(12);
    expect(overview.receivables).toMatchObject({
      outstanding: "3752000.00",
      overdue: "108800.00",
    });
    expect(overview.receivables.aging.find((b) => b.key === "d31_60").amount).toBe("108800.00");

    const sales = (await api("get", "/reports/sales", "manager")).body.data;
    expect(sales.totals).toMatchObject({ bookings: 1, netPrice: "4752000.00" });
    expect(sales.bySalesperson).toEqual([
      expect.objectContaining({ name: "Rahim Seller", count: 1, amount: "4752000.00" }),
    ]);

    const coll = (await api("get", "/reports/collections", "accounts")).body.data;
    expect(coll.totals).toMatchObject({ collected: "1000000.00", receipts: 1 });
    expect(coll.byMethod).toEqual([
      expect.objectContaining({ key: "CASH", name: "Cash", amount: "1000000.00" }),
    ]);

    const out = (await api("get", "/reports/outstanding?overdueOnly=true", "accounts")).body;
    expect(out.data.totals.overdue).toBe("108800.00");
    expect(out.data.rows[0]).toMatchObject({
      bookingNo: booking.bookingNo,
      overdue: "108800.00",
      daysLate: 40,
    });
    expect(out.meta.total).toBe(1);

    const statement = (await api("get", `/reports/customers/${karim.id}/statement`, "accounts"))
      .body.data;
    expect(statement.lines).toEqual([
      expect.objectContaining({ kind: "RECEIPT", in: "1000000", balance: "1000000.00" }),
    ]);
    expect(statement.bookings[0].balance.outstanding).toBe("3752000.00");

    // Sales executives have no reports
    expect((await api("get", "/reports/overview", "seller")).status).toBe(403);
  });
});

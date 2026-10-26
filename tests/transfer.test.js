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
let rokeya;

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
  rokeya = await prisma.customer.create({
    data: { customerCode: "CUS-000002", fullName: "Rokeya Begum", mobile: "8801811000002" },
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

describe("ownership transfer", () => {
  it("moves the booking and its paid money to the new customer once the fee is in", async () => {
    const booking = await paidBooking();
    const quote = await api("get", `/transfers/quote?bookingId=${booking.id}`, "manager");
    expect(quote.body.data).toMatchObject({
      amountPaid: "1000000.00",
      feeAmount: "47520.00",
      feePolicy: { text: "1% of the net price" },
    });
    expect(
      (
        await api("post", "/transfers", "seller", {
          bookingId: booking.id,
          toCustomerId: rokeya.id,
          reason: "Selling to sister",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api("post", "/transfers", "manager", {
          bookingId: booking.id,
          toCustomerId: karim.id,
          reason: "Same person",
        })
      ).status,
    ).toBe(422);

    const res = await api("post", "/transfers", "manager", {
      bookingId: booking.id,
      toCustomerId: rokeya.id,
      reason: "Selling to sister",
    });
    expect(res.status).toBe(201);
    const t = res.body.data;
    expect(t).toMatchObject({ transferNo: "TR-000001", status: "PENDING_APPROVAL" });
    // Cancelling and registering wait while it is open
    expect(
      (await api("post", "/cancellations", "manager", { bookingId: booking.id, reason: "x x x" }))
        .status,
    ).toBe(409);
    expect((await api("post", `/bookings/${booking.id}/register`, "manager", {})).status).toBe(409);

    await api("post", `/approvals/${t.approvalRequestId}/approve`, "accounts", { amount: 25000 });
    let after = (await api("get", `/transfers/${t.id}`, "accounts")).body.data;
    expect(after).toMatchObject({ status: "APPROVED", feeAmount: "25000" });
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).customerId).toBe(
      karim.id,
    );

    expect(
      (await api("post", `/transfers/${t.id}/complete`, "accountant", { method: "CASH" })).status,
    ).toBe(403);
    const done = await api("post", `/transfers/${t.id}/complete`, "accounts", {
      method: "BANK_TRANSFER",
      reference: "TT-901",
    });
    expect(done.status).toBe(200);
    after = done.body.data;
    expect(after).toMatchObject({
      status: "COMPLETED",
      amountPaid: "1000000",
      booking: { customer: { id: rokeya.id } },
      feeAccount: { code: "1121" },
    });
    expect(await lines("Transfer", t.id)).toEqual([
      ["CUSTOMER_ADVANCE", 1000000, 0],
      ["CUSTOMER_ADVANCE", 0, 1000000],
      ["BANK", 25000, 0],
      ["TRANSFER_FEE_INCOME", 0, 25000],
    ]);
    const byCustomer = await prisma.journalLine.groupBy({
      by: ["customerId"],
      where: { account: { systemKey: "CUSTOMER_ADVANCE" } },
      _sum: { debit: true, credit: true },
    });
    const held = (id) => {
      const row = byCustomer.find((r) => r.customerId === id);
      return Number(row._sum.credit) - Number(row._sum.debit);
    };
    expect([held(karim.id), held(rokeya.id)]).toEqual([0, 1000000]);

    // New payments are taken from the new owner
    const payment = (
      await api("post", "/collections", "accountant", {
        bookingId: booking.id,
        amount: 5000,
        method: "CASH",
      })
    ).body.data;
    expect(payment.customer?.id ?? payment.customerId).toBe(rokeya.id);
    const tb = (await api("get", "/accounts/trial-balance", "accounts")).body.data;
    expect(tb.balanced).toBe(true);
  });

  it("hands over on approval when there is no fee, and keeps the owner when rejected", async () => {
    await prisma.paymentPlan.update({ where: { id: plan.id }, data: { transferFeeValue: 0 } });
    const booking = await paidBooking();
    const first = (
      await api("post", "/transfers", "manager", {
        bookingId: booking.id,
        toCustomerId: rokeya.id,
        reason: "Gift",
      })
    ).body.data;
    expect(first.feeAmount).toBe("0");
    await api("post", `/approvals/${first.approvalRequestId}/reject`, "accounts", {
      comment: "Papers missing",
    });
    expect((await api("get", `/transfers/${first.id}`, "manager")).body.data).toMatchObject({
      status: "REJECTED",
      closeReason: "Papers missing",
      booking: { customer: { id: karim.id } },
    });

    const second = (
      await api("post", "/transfers", "manager", {
        bookingId: booking.id,
        toCustomerId: rokeya.id,
        reason: "Gift, papers ready",
      })
    ).body.data;
    await api("post", `/approvals/${second.approvalRequestId}/approve`, "accounts", {});
    expect((await api("get", `/transfers/${second.id}`, "manager")).body.data).toMatchObject({
      status: "COMPLETED",
      booking: { customer: { id: rokeya.id } },
    });
    expect(await lines("Transfer", second.id)).toEqual([
      ["CUSTOMER_ADVANCE", 1000000, 0],
      ["CUSTOMER_ADVANCE", 0, 1000000],
    ]);
  });
});

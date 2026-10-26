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
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

async function paidBooking(amount = 1000000) {
  const booking = (
    await api("post", "/bookings", "seller", {
      customerId: karim.id,
      plotId: plot.id,
      paymentPlanId: plan.id,
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

describe("cancellation", () => {
  it("cancels a booking with the approved refund, frees the plot and posts it", async () => {
    const booking = await paidBooking();
    const quote = await api("get", `/cancellations/quote?bookingId=${booking.id}`, "manager");
    expect(quote.body.data).toMatchObject({
      totalPaid: "1000000.00",
      chargeAmount: "100000.00",
      refundAmount: "900000.00",
    });
    expect(quote.body.data.policy.text).toBe("10% of the amount paid");

    const res = await api("post", "/cancellations", "manager", {
      bookingId: booking.id,
      reason: "Customer moving abroad",
    });
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c).toMatchObject({ cancellationNo: "CN-000001", status: "PENDING_APPROVAL" });
    expect(
      (await api("post", "/cancellations", "manager", { bookingId: booking.id, reason: "again" }))
        .status,
    ).toBe(409);
    const blocked = await api("post", "/collections", "accountant", {
      bookingId: booking.id,
      amount: 1000,
      method: "CASH",
    });
    expect(blocked.status).toBe(422);

    // The Sales Manager asked, so the chain goes straight to the Accounts Manager
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: c.approvalRequestId },
    });
    expect(approval.currentStepOrder).toBe(2);
    expect(
      (await api("post", `/approvals/${approval.id}/approve`, "accounts", { amount: 1200000 }))
        .status,
    ).toBe(422);
    const ok = await api("post", `/approvals/${approval.id}/approve`, "accounts", {
      amount: 850000,
    });
    expect(ok.status).toBe(200);

    const after = (await api("get", `/cancellations/${c.id}`, "accounts")).body.data;
    expect(after).toMatchObject({
      status: "APPROVED",
      refundAmount: "850000",
      chargeAmount: "150000",
      booking: { status: "CANCELLED" },
    });
    expect((await prisma.plot.findUnique({ where: { id: plot.id } })).status).toBe("AVAILABLE");
    const statuses = await prisma.installment.findMany({
      where: { bookingId: booking.id },
      orderBy: { number: "asc" },
      select: { status: true },
    });
    expect(statuses.slice(0, 2).map((i) => i.status)).toEqual(["PAID", "WAIVED"]);
    const cancelled = (await api("get", `/bookings/${booking.id}`, "manager")).body.data;
    expect(cancelled.balance).toMatchObject({
      paid: "1000000.00",
      outstanding: "0.00",
      overdue: "0.00",
    });
    expect(await lines("Cancellation", c.id)).toEqual([
      ["CUSTOMER_ADVANCE", 1000000, 0],
      ["CANCELLATION_INCOME", 0, 150000],
      ["REFUND_PAYABLE", 0, 850000],
    ]);

    // Refund payout by accounts
    expect(
      (await api("post", `/cancellations/${c.id}/refund`, "accountant", { method: "CASH" })).status,
    ).toBe(403);
    expect(
      (await api("post", `/cancellations/${c.id}/refund`, "accounts", { method: "BANK_TRANSFER" }))
        .status,
    ).toBe(400);
    const paid = await api("post", `/cancellations/${c.id}/refund`, "accounts", {
      method: "BANK_TRANSFER",
      reference: "TT-778",
    });
    expect(paid.body.data).toMatchObject({
      status: "REFUNDED",
      refundPaid: "850000.00",
      refundDue: "0.00",
      refundParts: [
        {
          number: 1,
          amount: "850000",
          status: "PAID",
          reference: "TT-778",
          account: { code: "1121" },
        },
      ],
    });
    expect(await lines("RefundPayment", paid.body.data.paidPart.id)).toEqual([
      ["REFUND_PAYABLE", 850000, 0],
      ["BANK", 0, 850000],
    ]);
    const tb = (await api("get", "/accounts/trial-balance", "accounts")).body.data;
    expect(tb.balanced).toBe(true);
    const accounts = (await api("get", "/accounts?balances=true", "accounts")).body.data;
    const balance = (key) => accounts.find((a) => a.systemKey === key).balance;
    expect([
      balance("CUSTOMER_ADVANCE"),
      balance("REFUND_PAYABLE"),
      balance("CANCELLATION_INCOME"),
    ]).toEqual(["0.00", "0.00", "150000.00"]);

    // The plot can be booked again
    const again = await api("post", "/bookings", "seller", {
      customerId: karim.id,
      plotId: plot.id,
      paymentPlanId: plan.id,
    });
    expect(again.status).toBe(201);
  });

  it("pays a refund in parts on a schedule", async () => {
    const booking = await paidBooking();
    const c = (
      await api("post", "/cancellations", "manager", { bookingId: booking.id, reason: "Abroad" })
    ).body.data;
    await api("post", `/approvals/${c.approvalRequestId}/approve`, "accounts", {});
    const schedule = (parts) =>
      api("put", `/cancellations/${c.id}/refund-schedule`, "accounts", { parts });
    expect(
      (
        await schedule([
          { dueDate: "2026-11-30", amount: 500000 },
          { dueDate: "2026-12-31", amount: 300000 },
        ])
      ).status,
    ).toBe(422); // ৳8,00,000 of ৳9,00,000
    let res = await schedule([
      { dueDate: "2026-12-31", amount: 400000 },
      { dueDate: "2026-11-30", amount: 500000 },
    ]);
    expect(res.body.data).toMatchObject({
      refundDue: "900000.00",
      nextRefund: { number: 1, amount: "500000" },
    });

    res = await api("post", `/cancellations/${c.id}/refund`, "accounts", { method: "CASH" });
    expect(res.body.data).toMatchObject({
      status: "APPROVED",
      refundPaid: "500000.00",
      refundDue: "400000.00",
      nextRefund: { number: 2 },
    });
    // The rest can be re-planned; the paid part stays
    res = await schedule([
      { dueDate: "2027-01-15", amount: 200000 },
      { dueDate: "2027-02-15", amount: 200000 },
    ]);
    expect(res.body.data.refundParts.map((p) => [p.number, p.amount, p.status])).toEqual([
      [1, "500000", "PAID"],
      [2, "200000", "DUE"],
      [3, "200000", "DUE"],
    ]);
    await api("post", `/cancellations/${c.id}/refund`, "accounts", { method: "CASH" });
    res = await api("post", `/cancellations/${c.id}/refund`, "accounts", {
      method: "BANK_TRANSFER",
      reference: "TT-1",
    });
    expect(res.body.data).toMatchObject({ status: "REFUNDED", refundPaid: "900000.00" });
    expect(
      (await api("post", `/cancellations/${c.id}/refund`, "accounts", { method: "CASH" })).status,
    ).toBe(409);
    const accounts = (await api("get", "/accounts?balances=true", "accounts")).body.data;
    expect(accounts.find((a) => a.systemKey === "REFUND_PAYABLE").balance).toBe("0.00");
    const statement = (await api("get", `/reports/customers/${karim.id}/statement`, "accounts"))
      .body.data;
    expect(statement.lines.filter((l) => l.kind === "REFUND").map((l) => l.out)).toEqual([
      "500000",
      "200000",
      "200000",
    ]);
  });

  it("takes the interest earned back out of income on cancellation", async () => {
    await prisma.paymentPlan.update({ where: { id: plan.id }, data: { interestRate: 10 } });
    // Down payment ৳9,50,400 + one installment ৳1,90,080 (৳31,680 of it interest)
    const booking = await paidBooking(1140480);
    const c = (
      await api("post", "/cancellations", "manager", { bookingId: booking.id, reason: "Abroad" })
    ).body.data;
    expect(c).toMatchObject({ totalPaid: "1140480", chargeAmount: "114048" });
    await api("post", `/approvals/${c.approvalRequestId}/approve`, "accounts", {});
    expect(await lines("Cancellation", c.id)).toEqual([
      ["CUSTOMER_ADVANCE", 1108800, 0],
      ["INTEREST_INCOME", 31680, 0],
      ["CANCELLATION_INCOME", 0, 114048],
      ["REFUND_PAYABLE", 0, 1026432],
    ]);
    const accounts = (await api("get", "/accounts?balances=true", "accounts")).body.data;
    const balance = (key) => accounts.find((a) => a.systemKey === key).balance;
    expect([balance("CUSTOMER_ADVANCE"), balance("INTEREST_INCOME")]).toEqual(["0.00", "0.00"]);
  });

  it("keeps the booking when the cancellation is rejected or withdrawn", async () => {
    const booking = await paidBooking();
    const c = (
      await api("post", "/cancellations", "manager", {
        bookingId: booking.id,
        reason: "Changed mind",
      })
    ).body.data;
    await api("post", `/approvals/${c.approvalRequestId}/reject`, "accounts", {
      comment: "Customer agreed to continue",
    });
    let after = (await api("get", `/cancellations/${c.id}`, "manager")).body.data;
    expect(after).toMatchObject({
      status: "REJECTED",
      closeReason: "Customer agreed to continue",
      booking: { status: "CONFIRMED" },
    });

    const second = (
      await api("post", "/cancellations", "manager", { bookingId: booking.id, reason: "Again" })
    ).body.data;
    await api("post", `/cancellations/${second.id}/withdraw`, "manager", {});
    after = (await api("get", `/cancellations/${second.id}`, "manager")).body.data;
    expect(after.status).toBe("WITHDRAWN");
    expect(
      (
        await api("post", "/collections", "accountant", {
          bookingId: booking.id,
          amount: 1000,
          method: "CASH",
        })
      ).status,
    ).toBe(201);
  });

  it("refuses registered bookings, pending payments and sales executives", async () => {
    const booking = await paidBooking();
    expect(
      (await api("post", "/cancellations", "seller", { bookingId: booking.id, reason: "x x x" }))
        .status,
    ).toBe(403);
    await api("post", "/collections", "accountant", {
      bookingId: booking.id,
      amount: 1000,
      method: "CASH",
    });
    expect(
      (await api("get", `/cancellations/quote?bookingId=${booking.id}`, "manager")).status,
    ).toBe(422);
    await prisma.payment.updateMany({ where: { status: "PENDING" }, data: { status: "REJECTED" } });
    await api("post", `/bookings/${booking.id}/register`, "manager", {});
    const res = await api("get", `/cancellations/quote?bookingId=${booking.id}`, "manager");
    expect(res.body.message).toBe("A registered (sold) booking can't be cancelled");
  });
});

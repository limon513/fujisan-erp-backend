import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { EmiService } from "#modules/emi/emi.service.js";
import { discoverModules } from "../src/routes/index.js";
import { syncApprovalWorkflows } from "../prisma/seed/core/approvals.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let org;
let plot;
let plan;
let karim;

const isoDay = (offsetDays) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

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
  org = {
    seller: await employee("Rahim Seller"),
    other: await employee("Other Seller"),
    manager: await employee("Selim Manager"),
  };
  org.users = {
    seller: await createUser({
      username: "seller",
      roleSlug: "sales-executive",
      employee: org.seller,
    }),
    other: await createUser({
      username: "other",
      roleSlug: "sales-executive",
      employee: org.other,
    }),
    manager: await createUser({
      username: "manager",
      roleSlug: "sales-manager",
      employee: org.manager,
    }),
    accountant: await createUser({ username: "accountant", roleSlug: "accountant" }),
    accounts: await createUser({ username: "accounts", roleSlug: "accounts-manager" }),
  };
  h = {};
  for (const name of Object.keys(org.users)) h[name] = await authHeader(request, app, name);

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
      ownerId: org.seller.id,
      branchId: branch.id,
    },
  });
  plan = await prisma.paymentPlan.create({
    data: {
      name: "24 months, 20% down",
      downPaymentValue: 20,
      installmentCount: 24,
      gracePeriodDays: 7,
      lateFeeType: "FIXED",
      lateFeeValue: 500,
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

/** A confirmed booking (no discount): ৳9,50,400 down, then 24 × ৳1,58,400. */
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

const pay = (booking, body = {}, as = "accountant") =>
  api("post", "/collections", as, {
    bookingId: booking.id,
    amount: 1000000,
    method: "CASH",
    ...body,
  });

const bookingOf = async (booking) =>
  (await api("get", `/bookings/${booking.id}`, "seller")).body.data;

describe("collections", () => {
  it("enters, verifies and applies a payment oldest first", async () => {
    const booking = await confirmedBooking();
    const res = await pay(booking);
    expect(res.status).toBe(201);
    const payment = res.body.data;
    expect(payment).toMatchObject({ paymentNo: "PAY-000001", receiptNo: null, status: "PENDING" });
    expect(payment.amountInWords).toBe("Taka Ten Lakh Only");

    // Counting the pending entry, at most ৳37,52,000 is still owed
    const over = await pay(booking, { amount: 3752001 });
    expect(over.status).toBe(422);

    expect((await api("post", `/collections/${payment.id}/verify`, "accountant")).status).toBe(403);
    const verified = await api("post", `/collections/${payment.id}/verify`, "accounts");
    expect(verified.body.data).toMatchObject({ status: "VERIFIED", receiptNo: "MR-000001" });
    expect(verified.body.data.allocations.map((a) => [a.installment.number, a.amount])).toEqual([
      [0, "950400"],
      [1, "49600"],
    ]);

    const after = await bookingOf(booking);
    expect(after.installments.slice(0, 3).map((i) => i.status)).toEqual(["PAID", "PARTIAL", "DUE"]);
    expect(after.balance).toMatchObject({
      paid: "1000000.00",
      outstanding: "3752000.00",
      overdue: "0.00",
    });
    expect(after.payments[0]).toMatchObject({ receiptNo: "MR-000001", status: "VERIFIED" });
    const note = await prisma.notification.findFirst({
      where: { userId: org.users.seller.id, type: "PAYMENT_RECEIVED" },
    });
    expect(note.title).toBe("Payment received: ৳10,00,000 from Karim Ahmed");
  });

  it("reverses a bounced cheque exactly and rejects bad entries", async () => {
    const booking = await confirmedBooking();
    expect((await pay(booking, { method: "CHEQUE" })).status).toBe(400); // needs the cheque number
    const cheque = (
      await pay(booking, { method: "CHEQUE", reference: "CHQ-1001", bankName: "City Bank" })
    ).body.data;
    await api("post", `/collections/${cheque.id}/verify`, "accounts");
    expect((await api("post", `/collections/${cheque.id}/reverse`, "accounts", {})).status).toBe(
      400,
    );
    const res = await api("post", `/collections/${cheque.id}/reverse`, "accounts", {
      reason: "Cheque bounced",
    });
    expect(res.body.data).toMatchObject({ status: "REVERSED", reverseReason: "Cheque bounced" });
    const after = await bookingOf(booking);
    expect(after.balance.paid).toBe("0.00");
    expect(after.installments.slice(0, 2).map((i) => i.status)).toEqual(["DUE", "DUE"]);
    expect(
      (await api("post", `/collections/${cheque.id}/reverse`, "accounts", { reason: "again" }))
        .status,
    ).toBe(409);

    const wrong = (await pay(booking, { amount: 5000 })).body.data;
    const rejected = await api("post", `/collections/${wrong.id}/reject`, "accounts", {
      reason: "Wrong amount",
    });
    expect(rejected.body.data.status).toBe("REJECTED");
    expect((await api("post", `/collections/${wrong.id}/verify`, "accounts")).status).toBe(409);
  });

  it("needs a second person to verify, and follows scope", async () => {
    const booking = await confirmedBooking();
    const own = (await pay(booking, {}, "accounts")).body.data;
    expect((await api("post", `/collections/${own.id}/verify`, "accounts")).status).toBe(403);

    expect((await api("get", `/collections/${own.id}`, "seller")).status).toBe(200);
    expect((await api("get", `/collections/${own.id}`, "other")).status).toBe(404);
    const list = await api("get", "/collections?status=PENDING", "accounts");
    expect(list.body.meta.totalAmount).toBe("1000000.00");
  });

  it("takes payments on confirmed bookings only", async () => {
    const pending = (
      await api("post", "/bookings", "seller", {
        customerId: karim.id,
        plotId: plot.id,
        paymentPlanId: plan.id,
      })
    ).body.data;
    expect((await pay(pending)).status).toBe(422);
  });
});

describe("EMI", () => {
  it("adds the late fee once after the grace period and reminds the salesperson", async () => {
    // Booked ~40 days ago: the down payment and installment 1 are past due + 7 days grace
    const booking = await confirmedBooking(isoDay(-40));
    const first = await EmiService.runDaily();
    expect(first.fees).toBe(2);
    expect(first.reminders).toBeGreaterThanOrEqual(2);
    expect(await EmiService.runDaily()).toEqual({ fees: 0, reminders: 0 });

    let after = await bookingOf(booking);
    expect(after.installments.slice(0, 3).map((i) => i.lateFee)).toEqual(["500", "500", "0"]);
    expect(after.balance).toMatchObject({
      overdueCount: 2,
      overdue: "1109800.00",
      lateFees: "1000.00",
    });
    const overdueNote = await prisma.notification.findFirst({
      where: { userId: org.users.seller.id, type: "INSTALLMENT_OVERDUE" },
    });
    expect(overdueNote.link).toBe(`/bookings/${booking.id}`);

    const overdue = await api("get", "/installments?when=overdue", "accounts");
    expect(overdue.body.data.map((i) => [i.number, i.outstanding])).toEqual([
      [0, "950900.00"],
      [1, "158900.00"],
    ]);
    const summary = (await api("get", "/installments/summary", "manager")).body.data;
    expect(summary.overdue).toMatchObject({ count: 2, amount: "1109800.00", bookings: 1 });

    // Paying the down payment with its late fee clears it
    const p = (await pay(booking, { amount: 950900 })).body.data;
    await api("post", `/collections/${p.id}/verify`, "accounts");
    after = await bookingOf(booking);
    expect(after.installments[0]).toMatchObject({ status: "PAID", paidAmount: "950900" });

    const waived = await api(
      "post",
      `/installments/${after.installments[1].id}/waive-late-fee`,
      "accounts",
      {
        reason: "Bank holiday delay",
      },
    );
    expect(waived.body.data).toMatchObject({ lateFee: "0", outstanding: "158400.00" });
    expect(
      (
        await api("post", `/installments/${after.installments[1].id}/waive-late-fee`, "seller", {
          reason: "x x",
        })
      ).status,
    ).toBe(403);
  });

  it("registers a confirmed booking and sells the plot", async () => {
    const booking = await confirmedBooking();
    const res = await api("post", `/bookings/${booking.id}/register`, "manager", {
      deedNo: "1234/2026",
      registeredOn: "2026-10-30",
    });
    expect(res.body.data).toMatchObject({
      status: "REGISTERED",
      deedNo: "1234/2026",
      plot: { status: "SOLD" },
    });
    expect((await api("post", `/bookings/${booking.id}/register`, "manager", {})).status).toBe(409);
    expect((await api("post", `/bookings/${booking.id}/register`, "seller", {})).status).toBe(403);
  });
});

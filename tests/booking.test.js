import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { discoverModules } from "../src/routes/index.js";
import { syncApprovalWorkflows } from "../prisma/seed/core/approvals.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let org;
let plots;
let plan;
let karim;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedAccessControl();
  const modules = await discoverModules();
  await prisma.$transaction((tx) =>
    syncApprovalWorkflows(tx, {
      modules,
      chains: { BOOKING: [{ name: "Sales Manager", approverType: "ROLE", role: "sales-manager" }] },
    }),
  );

  const branch = await prisma.branch.create({ data: { code: "HO", name: "HO" } });
  const sales = await prisma.department.create({ data: { code: "S", name: "Sales" } });
  const designation = await prisma.designation.create({ data: { name: "Staff" } });
  const team = await prisma.team.create({
    data: { name: "Alpha", branchId: branch.id, departmentId: sales.id },
  });
  let n = 0;
  const employee = (fullName, extra = {}) =>
    prisma.employee.create({
      data: {
        employeeCode: `E${++n}`,
        fullName,
        mobile: `88017110000${String(n).padStart(2, "0")}`,
        joiningDate: new Date("2026-01-01"),
        branchId: branch.id,
        departmentId: sales.id,
        designationId: designation.id,
        ...extra,
      },
    });
  org = {
    seller: await employee("Rahim Seller", { teamId: team.id }),
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
  };
  h = {};
  for (const name of Object.keys(org.users)) h[name] = await authHeader(request, app, name);

  const project = await prisma.project.create({ data: { code: "FC", name: "Fujisan City" } });
  const block = await prisma.block.create({
    data: { projectId: project.id, code: "A", name: "A" },
  });
  const plot = (number, status = "AVAILABLE") =>
    prisma.plot.create({
      data: {
        projectId: project.id,
        blockId: block.id,
        plotNumber: String(number),
        code: `A-${number}`,
        areaSqft: 1440,
        price: 4752000,
        status,
      },
    });
  plots = { free: await plot(1), held: await plot(2, "HOLD"), sold: await plot(3, "SOLD") };

  karim = await prisma.customer.create({
    data: {
      customerCode: "CUS-000001",
      fullName: "Karim Ahmed",
      mobile: "8801811000001",
      ownerId: org.seller.id,
      teamId: team.id,
      departmentId: sales.id,
      branchId: branch.id,
    },
  });
  const stranger = await prisma.customer.create({
    data: {
      customerCode: "CUS-000002",
      fullName: "Someone Else",
      mobile: "8801811000002",
      ownerId: org.other.id,
      branchId: branch.id,
    },
  });
  org.stranger = stranger;
  await prisma.plotHold.create({
    data: {
      plotId: plots.held.id,
      requestedById: org.other.id,
      heldById: org.users.manager.id,
      customerId: stranger.id,
      reason: "Visit",
      days: 3,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  plan = await prisma.paymentPlan.create({
    data: {
      name: "24 months, 20% down",
      downPaymentValue: 20,
      installmentCount: 24,
      cancellationChargeValue: 10,
    },
  });
});

const api = (method, path, as, body) =>
  request(app)[method](`/api/v1${path}`).set(h[as]).send(body);

const book = (extra = {}, as = "seller") =>
  api("post", "/bookings", as, {
    customerId: karim.id,
    plotId: plots.free.id,
    paymentPlanId: plan.id,
    bookingDate: "2026-10-25",
    ...extra,
  });

const approvalOf = async (booking) =>
  prisma.approvalRequest.findUnique({ where: { id: booking.approval.id } });

describe("bookings", () => {
  it("quotes the price after discount and the schedule", async () => {
    const res = await api("post", "/bookings/quote", "seller", {
      customerId: karim.id,
      plotId: plots.free.id,
      paymentPlanId: plan.id,
      bookingDate: "2026-10-25",
      discountType: "PERCENT",
      discountValue: 2,
    });
    expect(res.body.data).toMatchObject({
      listPrice: "4752000.00",
      discountAmount: "95040.00",
      discountPercent: "2.00",
      netPrice: "4656960.00",
    });
    expect(res.body.data.schedule.downPayment).toBe("931392.00");
  });

  it("reserves the plot and asks the Sales Manager, who may change the discount", async () => {
    const lead = await prisma.lead.create({
      data: {
        leadCode: "LD-1",
        fullName: "Karim Ahmed",
        mobile: "8801811000001",
        sourceId: (await prisma.leadSource.create({ data: { code: "WALK_IN", name: "Walk-in" } }))
          .id,
        ownerId: org.seller.id,
        status: "NEGOTIATION",
      },
    });
    let res = await book({
      discountValue: 100000,
      discountReason: "Pays the down payment today",
      leadId: lead.id,
    });
    expect(res.status).toBe(201);
    const booking = res.body.data;
    expect(booking).toMatchObject({
      bookingNo: "BK-000001",
      status: "PENDING_APPROVAL",
      discountRequested: "100000",
      netPrice: "4652000",
      plot: { status: "BOOKED" },
      approval: { status: "PENDING" },
    });
    expect((await prisma.lead.findUnique({ where: { id: lead.id } })).status).toBe("BOOKING");
    expect((await book({ customerId: karim.id })).status).toBe(409); // one live booking per plot

    const approval = await approvalOf(booking);
    const inbox = await api("get", "/approvals/inbox", "manager");
    expect(inbox.body.data.map((r) => r.id)).toEqual([approval.id]);

    const tooMuch = await api("post", `/approvals/${approval.id}/approve`, "manager", {
      amount: 5000000,
    });
    expect(tooMuch.status).toBe(422);

    res = await api("post", `/approvals/${approval.id}/approve`, "manager", {
      amount: 50000,
      comment: "Half of what was asked",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.actions.at(-1).comment).toBe(
      "Discount (৳) changed to 50,000. Half of what was asked",
    );

    const confirmed = (await api("get", `/bookings/${booking.id}`, "seller")).body.data;
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      discountRequested: "100000",
      discountAmount: "50000",
      netPrice: "4702000",
      totalPayable: "4702000",
      approval: { status: "APPROVED", approvedAmount: "50000" },
    });
    expect(confirmed.installments).toHaveLength(25);
    const sum = confirmed.installments.reduce((total, i) => total + toPaisa(i.amount), 0n);
    expect(fromPaisa(sum)).toBe("4702000.00");
    expect(confirmed.installments[0]).toMatchObject({
      kind: "DOWN_PAYMENT",
      amount: "940400",
      status: "DUE",
    });

    const converted = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(converted).toMatchObject({ status: "CONVERTED", convertedCustomerId: karim.id });
  });

  it("frees the plot when the booking is rejected or withdrawn", async () => {
    const first = (await book()).body.data;
    await api("post", `/approvals/${first.approval.id}/reject`, "manager", {
      comment: "Price too low",
    });
    let after = (await api("get", `/bookings/${first.id}`, "seller")).body.data;
    expect(after).toMatchObject({
      status: "REJECTED",
      closeReason: "Price too low",
      plot: { status: "AVAILABLE" },
    });

    const second = (await book()).body.data;
    expect((await api("post", `/bookings/${second.id}/withdraw`, "manager", {})).status).toBe(403);
    await api("post", `/bookings/${second.id}/withdraw`, "seller", {
      reason: "Customer changed mind",
    });
    after = (await api("get", `/bookings/${second.id}`, "seller")).body.data;
    expect(after).toMatchObject({ status: "CANCELLED", plot: { status: "AVAILABLE" } });
    expect((await api("post", `/bookings/${second.id}/withdraw`, "seller", {})).status).toBe(409);

    const history = await prisma.plotStatusHistory.findMany({
      where: { plotId: plots.free.id },
      orderBy: { createdAt: "asc" },
      select: { toStatus: true, refType: true },
    });
    expect(history.map((x) => `${x.refType}:${x.toStatus}`)).toEqual([
      "BOOKING:BOOKED",
      "BOOKING_REJECTED:AVAILABLE",
      "BOOKING:BOOKED",
      "CANCELLATION:AVAILABLE",
    ]);
  });

  it("books a held plot only for the customer it is held for", async () => {
    expect((await book({ plotId: plots.held.id })).status).toBe(409);
    expect((await book({ plotId: plots.sold.id })).status).toBe(409);

    // The other salesperson asked for the hold, for their customer
    const res = await api("post", "/bookings", "other", {
      customerId: org.stranger.id,
      plotId: plots.held.id,
      paymentPlanId: plan.id,
    });
    expect(res.status).toBe(201);
    const hold = await prisma.plotHold.findFirst({ where: { plotId: plots.held.id } });
    expect(hold.status).toBe("CONVERTED");
  });

  it("checks discount, customer and scope", async () => {
    expect((await book({ discountValue: 5000 })).status).toBe(400); // no reason
    expect(
      (await book({ discountType: "PERCENT", discountValue: 120, discountReason: "x" })).status,
    ).toBe(400);
    expect((await book({ customerId: org.stranger.id })).status).toBe(422); // not my customer

    const booking = (await book()).body.data;
    expect((await api("get", `/bookings/${booking.id}`, "other")).status).toBe(404);
    expect((await api("get", "/bookings", "manager")).body.data.map((b) => b.bookingNo)).toEqual([
      "BK-000001",
    ]);
    expect((await api("get", "/bookings?search=A-1", "seller")).body.data).toHaveLength(1);
  });
});

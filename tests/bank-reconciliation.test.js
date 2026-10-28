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

async function journal(narration, debitCode, creditCode, amount, date = isoDay(0)) {
  const res = await api("post", "/journals", "accountant", {
    date,
    narration,
    lines: [
      { accountId: await code(debitCode), debit: amount },
      { accountId: await code(creditCode), credit: amount },
    ],
  });
  expect(res.status).toBe(201);
}

describe("bank reconciliation", () => {
  it("matches a statement to the books and ties the balances", async () => {
    await journal("Capital deposited", "1121", "3100", 1000000, isoDay(-10));
    await journal("October rent, cheque CHQ-4471", "5500", "1121", 85000, isoDay(-8));
    const booking = await confirmedBooking();
    await paid(
      booking,
      { amount: 500000, method: "BANK_TRANSFER", reference: "EBL-TT-778", paidOn: isoDay(-5) },
      {},
    );
    await journal("Supplier cheque CHQ-4472", "5900", "1121", 30000, isoDay(-4));
    const bank = await code("1121");

    expect(
      (
        await api("post", "/bank-reconciliation/statements", "accountant", {
          accountId: bank,
          closingBalance: 1,
          lines: [{ date: isoDay(0), description: "x", amount: 1 }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api("post", "/bank-reconciliation/statements", "accounts", {
          accountId: await code("1110"),
          closingBalance: 1,
          lines: [{ date: isoDay(0), description: "x", amount: 1 }],
        })
      ).status,
    ).toBe(422);

    const lines = [
      { date: isoDay(-10), description: "Cash deposit", amount: 1000000 },
      { date: isoDay(-7), description: "Cheque paid", reference: "4471", amount: -85000 },
      { date: isoDay(-5), description: "TT EBL-TT-778 KARIM AHMED", amount: 500000 },
      { date: isoDay(-3), description: "SMS and service charge", amount: -575 },
    ];
    const res = await api("post", "/bank-reconciliation/statements", "accounts", {
      accountId: bank,
      fileName: "ebl-october.csv",
      closingBalance: 1414425,
      lines,
    });
    expect(res.status).toBe(201);
    let s = res.body.data;
    expect(s).toMatchObject({
      imported: 4,
      autoMatched: 3,
      counts: { MATCHED: 3, UNMATCHED: 1 },
      summary: {
        bookBalance: "1385000.00",
        notOnStatement: "-30000.00",
        notInBooks: "-575.00",
        adjustedBalance: "1414425.00",
        balancesTie: true,
        reconciled: false, // the bank charge isn't in the books yet
      },
    });
    expect(s.summary.uncleared.map((l) => l.entry.narration)).toEqual(["Supplier cheque CHQ-4472"]);

    // The bank charge goes into the books from the statement
    const charge = s.lines.find((l) => l.status === "UNMATCHED");
    s = (
      await api("post", `/bank-reconciliation/lines/${charge.id}/book`, "accounts", {
        accountId: await code("5700"),
      })
    ).body.data;
    expect(s.summary).toMatchObject({
      bookBalance: "1384425.00",
      notInBooks: "0.00",
      reconciled: true,
    });

    // Re-importing the same export is refused; a newer export with one new line keeps only that
    const again = await api("post", "/bank-reconciliation/statements", "accounts", {
      accountId: bank,
      closingBalance: 1414425,
      lines,
    });
    expect(again.status).toBe(409);
    const newer = (
      await api("post", "/bank-reconciliation/statements", "accounts", {
        accountId: bank,
        closingBalance: 1413925,
        lines: [...lines, { date: isoDay(0), description: "Cheque book fee", amount: -500 }],
      })
    ).body.data;
    expect([newer.imported, newer.duplicates]).toEqual([1, 4]);
    await api("delete", `/bank-reconciliation/statements/${newer.id}`, "accounts");

    // Undo and redo a match by hand
    const rent = s.lines.find((l) => l.reference === "4471");
    s = (await api("post", `/bank-reconciliation/lines/${rent.id}/unmatch`, "accounts")).body.data;
    expect(s.summary.reconciled).toBe(false);
    const options = (
      await api("get", `/bank-reconciliation/lines/${rent.id}/candidates`, "accounts")
    ).body.data;
    expect(options.map((o) => o.entry.narration)).toEqual(["October rent, cheque CHQ-4471"]);
    const deposit = s.lines.find((l) => l.description === "Cash deposit");
    expect(
      (
        await api("post", `/bank-reconciliation/lines/${rent.id}/match`, "accounts", {
          journalLineId: deposit.journalLine.id,
        })
      ).status,
    ).toBe(409);
    s = (
      await api("post", `/bank-reconciliation/lines/${rent.id}/match`, "accounts", {
        journalLineId: options[0].id,
      })
    ).body.data;
    expect(s.summary.reconciled).toBe(true);

    const list = (await api("get", `/bank-reconciliation/statements?accountId=${bank}`, "accounts"))
      .body.data;
    expect(list.map((x) => [x.lineCount, x.unmatched])).toEqual([[4, 0]]);
  });
});

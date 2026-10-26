import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import prisma from "#core/db/prisma.js";
import { EmiService } from "#modules/emi/emi.service.js";
import { JournalService } from "#modules/journal/journal.service.js";
import { discoverModules } from "../src/routes/index.js";
import { syncApprovalWorkflows } from "../prisma/seed/core/approvals.js";
import { authHeader, createUser, resetDatabase, seedAccessControl } from "./helpers/db.js";

let app;
let h;
let karim;
let plot;
let plan;
let acc;

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
  acc = Object.fromEntries(
    (await prisma.account.findMany({ where: { systemKey: { not: null } } })).map((a) => [
      a.systemKey,
      a,
    ]),
  );
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

const entryFor = (sourceId, kind = "AUTO") =>
  prisma.journalEntry.findFirst({
    where: { sourceId, kind },
    include: {
      lines: { include: { account: true }, orderBy: { lineNo: "asc" } },
      fiscalYear: true,
    },
  });

const sides = (entry) =>
  entry.lines.map((l) => [
    l.account.systemKey ?? l.account.code,
    Number(l.debit),
    Number(l.credit),
  ]);

const trialBalance = async () =>
  (await api("get", "/accounts/trial-balance", "accounts")).body.data;

describe("automatic postings", () => {
  it("posts a verified payment to cash and customer advance, in its fiscal year", async () => {
    const booking = await confirmedBooking();
    const res = await paid(booking);
    expect(res.status).toBe(200);
    const entry = await entryFor(res.body.data.id);
    expect(entry.entryNo).toBe("JV-000001");
    expect(sides(entry)).toEqual([
      ["CASH", 1000000, 0],
      ["CUSTOMER_ADVANCE", 0, 1000000],
    ]);
    expect(entry.lines[1]).toMatchObject({ customerId: karim.id, bookingId: booking.id });
    const year =
      isoDay(0).slice(0, 7) >= `${isoDay(0).slice(0, 4)}-07`
        ? Number(isoDay(0).slice(0, 4))
        : Number(isoDay(0).slice(0, 4)) - 1;
    expect(entry.fiscalYear.name).toBe(`FY ${year}-${String(year + 1).slice(2)}`);

    const tb = await trialBalance();
    expect(tb).toMatchObject({
      totalDebit: "1000000.00",
      totalCredit: "1000000.00",
      balanced: true,
    });
  });

  it("deposits to the account chosen at verification", async () => {
    const booking = await confirmedBooking();
    const bad = await paid(
      booking,
      { method: "CHEQUE", reference: "CHQ-1" },
      { depositAccountId: acc.SALES_REVENUE.id },
    );
    expect(bad.status).toBe(422);
    const pending = await prisma.payment.findFirst({ where: { status: "PENDING" } });
    const bank = await api("post", "/accounts", "accounts", {
      code: "1122",
      name: "Dutch-Bangla Bank",
      parentId: acc.BANK.parentId,
      bankName: "Dutch-Bangla Bank PLC",
      bankBranch: "Gulshan",
      accountTitle: "Fujisan Properties Ltd.",
      accountNumber: "1031100045678",
      routingNumber: "090261725",
      swiftCode: "dbblbddh",
    });
    // Under the bank group it is a bank account, with its details
    expect(bank.body.data).toMatchObject({
      type: "ASSET",
      isBank: true,
      accountNumber: "1031100045678",
      swiftCode: "DBBLBDDH",
    });
    expect(
      (
        await api("post", "/accounts", "accounts", {
          code: "1123",
          name: "X",
          parentId: acc.BANK.parentId,
          routingNumber: "12",
        })
      ).status,
    ).toBe(400);
    // Other accounts keep no bank details
    const petty = await api("post", "/accounts", "accounts", {
      code: "1112",
      name: "Petty cash, site office",
      parentId: acc.CASH.parentId,
      accountNumber: "123456789",
    });
    expect(petty.body.data).toMatchObject({ isBank: false, accountNumber: null });
    await api("post", `/collections/${pending.id}/verify`, "accounts", {
      depositAccountId: bank.body.data.id,
    });
    const entry = await entryFor(pending.id);
    expect(entry.lines[0].account.code).toBe("1122");
  });

  it("splits the late-fee part into late fee income", async () => {
    const booking = await confirmedBooking(isoDay(-40));
    await EmiService.runDaily();
    const res = await paid(booking, { amount: 950900 });
    expect(sides(await entryFor(res.body.data.id))).toEqual([
      ["CASH", 950900, 0],
      ["CUSTOMER_ADVANCE", 0, 950400],
      ["LATE_FEE_INCOME", 0, 500],
    ]);
  });

  it("mirrors a reversed payment", async () => {
    const booking = await confirmedBooking();
    const payment = (await paid(booking)).body.data;
    await api("post", `/collections/${payment.id}/reverse`, "accounts", {
      reason: "Cheque bounced",
    });
    const reversal = await entryFor(payment.id, "REVERSAL");
    expect(sides(reversal)).toEqual([
      ["CASH", 0, 1000000],
      ["CUSTOMER_ADVANCE", 1000000, 0],
    ]);
    const cash = (await api("get", `/accounts/${acc.CASH.id}/ledger`, "accounts")).body.data;
    expect(cash).toMatchObject({
      closingBalance: "0.00",
      totalDebit: "1000000.00",
      totalCredit: "1000000.00",
    });
    expect(cash.lines.map((l) => l.balance)).toEqual(["1000000.00", "0.00"]);
  });

  it("recognises revenue at registration and then reduces the receivable", async () => {
    const booking = await confirmedBooking();
    await paid(booking);
    await api("post", `/bookings/${booking.id}/register`, "manager", { deedNo: "1/2026" });
    expect(sides(await entryFor(booking.id))).toEqual([
      ["CUSTOMER_ADVANCE", 1000000, 0],
      ["CUSTOMER_RECEIVABLE", 3752000, 0],
      ["SALES_REVENUE", 0, 4752000],
    ]);
    const after = (await paid(booking, { amount: 158400 })).body.data;
    expect(sides(await entryFor(after.id))).toEqual([
      ["CASH", 158400, 0],
      ["CUSTOMER_RECEIVABLE", 0, 158400],
    ]);
    const list = (await api("get", "/accounts?balances=true", "accounts")).body.data;
    const balance = (key) => list.find((a) => a.systemKey === key).balance;
    expect(balance("CUSTOMER_ADVANCE")).toBe("0.00");
    expect(balance("CUSTOMER_RECEIVABLE")).toBe("3593600.00");
    expect(balance("SALES_REVENUE")).toBe("4752000.00");
    expect(list.find((a) => a.code === "1000").balance).toBe("4752000.00"); // assets group
    expect((await trialBalance()).balanced).toBe(true);
  });
});

describe("installment interest", () => {
  it("earns interest with each installment paid, not at registration", async () => {
    const withInterest = await prisma.paymentPlan.create({
      data: {
        name: "24 months, 10%",
        downPaymentValue: 20,
        installmentCount: 24,
        interestRate: 10,
      },
    });
    const booking = (
      await api("post", "/bookings", "seller", {
        customerId: karim.id,
        plotId: plot.id,
        paymentPlanId: withInterest.id,
      })
    ).body.data;
    expect(booking).toMatchObject({ interestAmount: "760320", totalPayable: "5512320" });
    await api("post", `/approvals/${booking.approval.id}/approve`, "manager", {});

    // The down payment carries no interest
    const down = (await paid(booking, { amount: 950400 })).body.data;
    expect(sides(await entryFor(down.id))).toEqual([
      ["CASH", 950400, 0],
      ["CUSTOMER_ADVANCE", 0, 950400],
    ]);
    // Half an installment earns half its interest; the other half comes with the rest of it
    const half = (await paid(booking, { amount: 95040 })).body.data;
    expect(sides(await entryFor(half.id))).toEqual([
      ["CASH", 95040, 0],
      ["CUSTOMER_ADVANCE", 0, 79200],
      ["INTEREST_INCOME", 0, 15840],
    ]);
    const rest = (await paid(booking, { amount: 95040 })).body.data;
    expect(sides(await entryFor(rest.id))).toEqual([
      ["CASH", 95040, 0],
      ["CUSTOMER_ADVANCE", 0, 79200],
      ["INTEREST_INCOME", 0, 15840],
    ]);

    // Registration recognises the net price only
    await api("post", `/bookings/${booking.id}/register`, "manager", {});
    expect(sides(await entryFor(booking.id))).toEqual([
      ["CUSTOMER_ADVANCE", 1108800, 0],
      ["CUSTOMER_RECEIVABLE", 3643200, 0],
      ["SALES_REVENUE", 0, 4752000],
    ]);
    const after = (await paid(booking, { amount: 190080 })).body.data;
    expect(sides(await entryFor(after.id))).toEqual([
      ["CASH", 190080, 0],
      ["CUSTOMER_RECEIVABLE", 0, 158400],
      ["INTEREST_INCOME", 0, 31680],
    ]);

    // A reversed payment takes its interest back, and the next payment earns it again
    await api("post", `/collections/${after.id}/reverse`, "accounts", { reason: "Cheque bounced" });
    const again = (await paid(booking, { amount: 190080 })).body.data;
    expect(sides(await entryFor(again.id))[2]).toEqual(["INTEREST_INCOME", 0, 31680]);
    const list = (await api("get", "/accounts?balances=true", "accounts")).body.data;
    const balance = (key) => list.find((a) => a.systemKey === key).balance;
    expect(balance("INTEREST_INCOME")).toBe("63360.00");
    expect(balance("CUSTOMER_RECEIVABLE")).toBe("3484800.00");
    expect((await trialBalance()).balanced).toBe(true);
  });
});

describe("manual journals and fiscal years", () => {
  const rent = (extra = {}) => ({
    date: isoDay(0),
    narration: "October office rent",
    lines: [
      { accountId: null, debit: 85000 },
      { accountId: acc.BANK.id, credit: 85000 },
    ],
    ...extra,
  });

  it("posts balanced entries to postable accounts and reverses them once", async () => {
    const rentAccount = await prisma.account.findUnique({ where: { code: "5500" } });
    const ok = rent();
    ok.lines[0].accountId = rentAccount.id;

    const unbalanced = structuredClone(ok);
    unbalanced.lines[1].credit = 80000;
    expect((await api("post", "/journals", "accountant", unbalanced)).body.errors[0].path).toBe(
      "lines",
    );
    const group = structuredClone(ok);
    group.lines[0].accountId = rentAccount.parentId;
    expect((await api("post", "/journals", "accountant", group)).status).toBe(422);

    const res = await api("post", "/journals", "accountant", ok);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "MANUAL", total: "85000.00" });
    expect(
      (
        await api("post", `/journals/${res.body.data.id}/reverse`, "accountant", {
          reason: "Wrong month",
        })
      ).status,
    ).toBe(403);
    const reversed = await api("post", `/journals/${res.body.data.id}/reverse`, "accounts", {
      reason: "Wrong month",
    });
    expect(reversed.body.data).toMatchObject({
      kind: "REVERSAL",
      reverses: { entryNo: res.body.data.entryNo },
    });
    expect(
      (await api("post", `/journals/${res.body.data.id}/reverse`, "accounts", { reason: "again" }))
        .status,
    ).toBe(409);
    expect((await api("get", "/journals", "seller")).status).toBe(403);
  });

  it("refuses postings into a closed year, and journal lines can't be edited", async () => {
    const rentAccount = await prisma.account.findUnique({ where: { code: "5500" } });
    const body = rent();
    body.lines[0].accountId = rentAccount.id;
    const first = (await api("post", "/journals", "accounts", body)).body.data;
    const years = (await api("get", "/fiscal-years", "accounts")).body.data;
    expect(years[0]).toMatchObject({ status: "OPEN", entryCount: 1 });
    await api("post", `/fiscal-years/${years[0].id}/close`, "accounts");
    const res = await api("post", "/journals", "accounts", body);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("is closed");
    await api("post", `/fiscal-years/${years[0].id}/reopen`, "accounts");

    const line = await prisma.journalLine.findFirst({ where: { entryId: first.id } });
    await expect(
      prisma.journalLine.update({ where: { id: line.id }, data: { debit: 1 } }),
    ).rejects.toThrow();
  });

  it("backfills payments verified before accounting existed, once", async () => {
    const booking = await confirmedBooking();
    const payment = (await paid(booking)).body.data;
    await prisma.journalEntry.deleteMany({ where: { sourceId: payment.id } });
    expect(await JournalService.backfill()).toBe(1);
    expect(await JournalService.backfill()).toBe(0);
    expect(sides(await entryFor(payment.id))).toEqual([
      ["CASH", 1000000, 0],
      ["CUSTOMER_ADVANCE", 0, 1000000],
    ]);
  });
});

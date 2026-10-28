import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { dhakaDate } from "#core/utils/time.js";
import { DEBIT_NORMAL } from "./account.service.js";

/**
 * Financial statements from the journal: profit and loss, balance sheet, cash and bank book and
 * cash flow (direct method). Nothing is stored; every figure is summed from journal lines, so the
 * statements always agree with the ledgers and the trial balance.
 */

const MONEY_KEYS = ["CASH", "BANK", "BKASH", "NAGAD"];
const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const accountSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  parentId: true,
  isGroup: true,
  systemKey: true,
};

/** First day of the fiscal year containing `date` (company setting, July by default). */
async function fiscalYearStart(date) {
  const company = await prisma.company.findFirst({ select: { fiscalYearStartMonth: true } });
  const month = (company?.fiscalYearStartMonth ?? 7) - 1;
  const year = date.getUTCMonth() >= month ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, month, 1));
}

async function periodOf({ from, to }) {
  const end = to ?? dhakaDate();
  const start = from ?? (await fiscalYearStart(end));
  if (start > end) throw invalid("from", "The start date must be on or before the end date");
  return { from: start, to: end };
}

/** Debit/credit totals per account for journal lines matching `entry`. */
async function totals(entry) {
  const rows = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { entry },
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((r) => [r.accountId, toPaisa(r._sum.debit ?? 0) - toPaisa(r._sum.credit ?? 0)]),
  );
}

/** Balance in the account's normal direction from a net debit amount. */
const normal = (type, net) => (DEBIT_NORMAL.includes(type) ? net : -net);

/**
 * The chart of the given types as an indented list, each account with its amount and each group
 * the sum of what is under it; rows that are zero all the way down are left out.
 */
function tree(accounts, net, types) {
  const children = new Map();
  for (const a of accounts) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const rows = [];
  const walk = (account, depth) => {
    const at = rows.length;
    rows.push(null);
    let amount = account.isGroup ? 0n : normal(account.type, net.get(account.id) ?? 0n);
    for (const child of children.get(account.id) ?? []) amount += walk(child, depth + 1);
    const used = amount !== 0n || rows.length - at > 1;
    if (used) {
      rows[at] = {
        id: account.id,
        code: account.code,
        name: account.name,
        systemKey: account.systemKey,
        isGroup: account.isGroup,
        depth,
        amount: fromPaisa(amount),
      };
    } else rows.splice(at, 1);
    return amount;
  };
  let total = 0n;
  for (const root of (children.get(null) ?? []).filter((a) => types.includes(a.type)))
    total += walk(root, 0);
  return { rows, total };
}

const allAccounts = () =>
  prisma.account.findMany({ orderBy: { code: "asc" }, select: accountSelect });

// ---- Profit and loss ------------------------------------------------------------------------

const profitAndLoss = async (query) => {
  const { from, to } = await periodOf(query);
  const [accounts, net] = await Promise.all([
    allAccounts(),
    totals({ date: { gte: from, lte: to } }),
  ]);
  const income = tree(accounts, net, ["INCOME"]);
  const expenses = tree(accounts, net, ["EXPENSE"]);
  const byKey = (key) => {
    const account = accounts.find((a) => a.systemKey === key);
    return account ? normal(account.type, net.get(account.id) ?? 0n) : 0n;
  };
  const sales = byKey("SALES_REVENUE");
  const costOfSales = byKey("COST_OF_SALES");
  const profit = income.total - expenses.total;
  return {
    from,
    to,
    income: { rows: income.rows, total: fromPaisa(income.total) },
    expenses: { rows: expenses.rows, total: fromPaisa(expenses.total) },
    grossProfit: {
      sales: fromPaisa(sales),
      costOfSales: fromPaisa(costOfSales),
      amount: fromPaisa(sales - costOfSales),
    },
    netProfit: fromPaisa(profit),
    margin: income.total > 0n ? Number((profit * 1000n) / income.total) / 10 : null,
  };
};

// ---- Balance sheet --------------------------------------------------------------------------

/**
 * Assets = liabilities + equity as of a date. Fiscal years are locked, not closed into retained
 * earnings, so the profit to date shows in equity as two lines: earlier years and this year.
 */
const balanceSheet = async ({ asOf }) => {
  const date = asOf ?? dhakaDate();
  const yearStart = await fiscalYearStart(date);
  const [accounts, net, before] = await Promise.all([
    allAccounts(),
    totals({ date: { lte: date } }),
    totals({ date: { lt: yearStart } }),
  ]);
  const profitOf = (map) => {
    let profit = 0n;
    for (const a of accounts) {
      if (a.isGroup || !["INCOME", "EXPENSE"].includes(a.type)) continue;
      profit -= map.get(a.id) ?? 0n; // income is credit-normal: −net is income; expenses subtract
    }
    return profit;
  };
  const toDate = profitOf(net);
  const earlier = profitOf(before);
  const assets = tree(accounts, net, ["ASSET"]);
  const liabilities = tree(accounts, net, ["LIABILITY"]);
  const equity = tree(accounts, net, ["EQUITY"]);
  const equityRows = [
    ...equity.rows,
    ...(earlier !== 0n
      ? [
          {
            id: "profit-earlier",
            name: "Profit of earlier years (not yet transferred)",
            depth: 1,
            amount: fromPaisa(earlier),
          },
        ]
      : []),
    {
      id: "profit-year",
      name: `Profit this fiscal year (from ${yearStart.toISOString().slice(0, 10)})`,
      depth: 1,
      amount: fromPaisa(toDate - earlier),
    },
  ];
  const equityTotal = equity.total + toDate;
  return {
    asOf: date,
    fiscalYearStart: yearStart,
    assets: { rows: assets.rows, total: fromPaisa(assets.total) },
    liabilities: { rows: liabilities.rows, total: fromPaisa(liabilities.total) },
    equity: { rows: equityRows, total: fromPaisa(equityTotal) },
    liabilitiesAndEquity: fromPaisa(liabilities.total + equityTotal),
    balanced: assets.total === liabilities.total + equityTotal,
  };
};

// ---- Cash and bank book ---------------------------------------------------------------------

/**
 * Cash, bank and mobile accounts: the seeded money accounts, bank accounts, and accounts in a
 * group of their own (Bank accounts, Mobile financial services). A group that also holds accounts
 * used for something else (Cash in hand sits beside Customer receivable in Current assets) adds
 * nothing but the money account itself.
 */
export async function moneyAccounts(db = prisma) {
  const accounts = await db.account.findMany({
    where: { type: "ASSET" },
    orderBy: { code: "asc" },
    select: { ...accountSelect, isActive: true, isBank: true, bankName: true, accountNumber: true },
  });
  const mixed = new Set(
    accounts.filter((a) => a.systemKey && !MONEY_KEYS.includes(a.systemKey)).map((a) => a.parentId),
  );
  const groups = new Set(
    accounts
      .filter((a) => MONEY_KEYS.includes(a.systemKey) && !mixed.has(a.parentId))
      .map((a) => a.parentId),
  );
  return accounts.filter(
    (a) => !a.isGroup && (MONEY_KEYS.includes(a.systemKey) || a.isBank || groups.has(a.parentId)),
  );
}

/** Entry id → the other accounts on it (what the money came from or went to). */
async function contraOf(entryIds, exclude) {
  const lines = await prisma.journalLine.findMany({
    where: { entryId: { in: entryIds }, accountId: { notIn: exclude } },
    select: {
      entryId: true,
      debit: true,
      credit: true,
      account: {
        select: { id: true, code: true, name: true, type: true, parentId: true, systemKey: true },
      },
    },
  });
  const map = new Map();
  for (const l of lines) map.set(l.entryId, [...(map.get(l.entryId) ?? []), l]);
  return map;
}

/**
 * Receipts and payments of every money account in a period, and the dated lines of one of them
 * (or all together) with what each was received from or paid for and a running balance.
 */
const cashBook = async (query) => {
  const { from, to } = await periodOf(query);
  const money = await moneyAccounts();
  const ids = money.map((a) => a.id);
  if (query.accountId && !ids.includes(query.accountId))
    throw invalid("accountId", "Choose a cash, bank or mobile account");
  const [opening, movement] = await Promise.all([
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, entry: { date: { lt: from } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, entry: { date: { gte: from, lte: to } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const sumOf = (rows, id, side) => toPaisa(rows.find((r) => r.accountId === id)?._sum[side] ?? 0);
  const accounts = money.map((a) => {
    const open = sumOf(opening, a.id, "debit") - sumOf(opening, a.id, "credit");
    const inflow = sumOf(movement, a.id, "debit");
    const outflow = sumOf(movement, a.id, "credit");
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      isBank: a.isBank,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      opening: fromPaisa(open),
      receipts: fromPaisa(inflow),
      payments: fromPaisa(outflow),
      closing: fromPaisa(open + inflow - outflow),
    };
  });

  const selected = query.accountId ? [query.accountId] : ids;
  const lines = await prisma.journalLine.findMany({
    where: { accountId: { in: selected }, entry: { date: { gte: from, lte: to } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { entryNo: "asc" } }, { lineNo: "asc" }],
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      account: { select: { id: true, code: true, name: true } },
      entry: { select: { id: true, entryNo: true, date: true, narration: true } },
    },
  });
  const contra = await contraOf([...new Set(lines.map((l) => l.entry.id))], selected);
  let running = accounts
    .filter((a) => selected.includes(a.id))
    .reduce((sum, a) => sum + toPaisa(a.opening), 0n);
  const openingTotal = running;
  const rows = lines.map((l) => {
    running += toPaisa(l.debit) - toPaisa(l.credit);
    const others = contra.get(l.entry.id) ?? [];
    return {
      id: l.id,
      date: l.entry.date,
      entryId: l.entry.id,
      entryNo: l.entry.entryNo,
      narration: l.description ?? l.entry.narration,
      account: l.account,
      contra: [
        ...new Map(
          others.map((o) => [o.account.id, `${o.account.code} ${o.account.name}`]),
        ).values(),
      ],
      receipt: l.debit.toString(),
      payment: l.credit.toString(),
      balance: fromPaisa(running),
    };
  });
  return {
    from,
    to,
    accounts,
    accountId: query.accountId ?? null,
    opening: fromPaisa(openingTotal),
    closing: fromPaisa(running),
    lines: rows,
  };
};

// ---- Cash flow (direct method) --------------------------------------------------------------

const CASH_FLOW_SECTIONS = {
  OPERATING: "Operating activities",
  INVESTING: "Investing activities",
  FINANCING: "Financing activities",
};

/**
 * Where money came from and went in a period, by the account on the other side of each money
 * movement. Moves between money accounts (cash deposited in the bank) are left out.
 *   Financing: equity, and liabilities outside the group holding customer advances (loans).
 *   Investing: assets outside the groups holding money, receivables and land (fixed assets).
 *   Operating: everything else (customers, refunds, land and development, expenses, payables).
 */
const cashFlow = async (query) => {
  const { from, to } = await periodOf(query);
  const [accounts, money] = await Promise.all([allAccounts(), moneyAccounts()]);
  const moneyIds = money.map((a) => a.id);
  const parentOf = new Map(accounts.map((a) => [a.id, a.parentId]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // The group right under a type's top-level group (1100 Current assets, 2200 Long-term loans …)
  const sectionGroup = (id) => {
    let current = id;
    while (parentOf.get(current) && parentOf.get(parentOf.get(current)))
      current = parentOf.get(current);
    return current;
  };
  const groupOfKey = (key) => {
    const a = accounts.find((x) => x.systemKey === key);
    return a ? sectionGroup(a.id) : null;
  };
  const operatingAssetGroups = new Set(
    ["CASH", "CUSTOMER_RECEIVABLE", "LAND_COST", "DEVELOPMENT_COST"]
      .map(groupOfKey)
      .filter(Boolean),
  );
  const operatingLiabilityGroups = new Set(
    ["CUSTOMER_ADVANCE", "REFUND_PAYABLE"].map(groupOfKey).filter(Boolean),
  );
  const sectionOf = (account) => {
    if (account.type === "EQUITY") return "FINANCING";
    if (account.type === "LIABILITY")
      return operatingLiabilityGroups.has(sectionGroup(account.id)) ? "OPERATING" : "FINANCING";
    if (account.type === "ASSET")
      return operatingAssetGroups.has(sectionGroup(account.id)) ? "OPERATING" : "INVESTING";
    return "OPERATING";
  };

  const entries = await prisma.journalEntry.findMany({
    where: { date: { gte: from, lte: to }, lines: { some: { accountId: { in: moneyIds } } } },
    select: { id: true },
  });
  const contra = await contraOf(
    entries.map((e) => e.id),
    moneyIds,
  );
  // Each other-side line moved money by its credit − debit (the entry balances, so these add
  // up to the entry's net money movement)
  const flows = new Map();
  for (const lines of contra.values()) {
    for (const l of lines) {
      const amount = toPaisa(l.credit) - toPaisa(l.debit);
      if (amount === 0n) continue;
      const row = flows.get(l.account.id) ?? { account: l.account, amount: 0n };
      row.amount += amount;
      flows.set(l.account.id, row);
    }
  }
  const sections = Object.entries(CASH_FLOW_SECTIONS).map(([key, label]) => {
    const rows = [...flows.values()]
      .filter((f) => sectionOf(byId.get(f.account.id)) === key && f.amount !== 0n)
      .sort((a, b) => a.account.code.localeCompare(b.account.code))
      .map((f) => ({
        id: f.account.id,
        code: f.account.code,
        name: f.account.name,
        amount: fromPaisa(f.amount),
      }));
    const total = rows.reduce((sum, r) => sum + toPaisa(r.amount), 0n);
    return { key, label, rows, total: fromPaisa(total) };
  });

  const balance = async (entry) => {
    const s = await prisma.journalLine.aggregate({
      where: { accountId: { in: moneyIds }, entry },
      _sum: { debit: true, credit: true },
    });
    return toPaisa(s._sum.debit ?? 0) - toPaisa(s._sum.credit ?? 0);
  };
  const opening = await balance({ date: { lt: from } });
  const closing = await balance({ date: { lte: to } });
  const change = sections.reduce((sum, s) => sum + toPaisa(s.total), 0n);
  return {
    from,
    to,
    sections,
    netChange: fromPaisa(change),
    opening: fromPaisa(opening),
    closing: fromPaisa(closing),
    reconciles: opening + change === closing,
  };
};

export const AccountStatements = { profitAndLoss, balanceSheet, cashBook, cashFlow };

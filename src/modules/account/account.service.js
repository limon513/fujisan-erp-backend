import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { dhakaDate } from "#core/utils/time.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/** Assets and expenses grow with debits; liabilities, equity and income with credits. */
export const DEBIT_NORMAL = ["ASSET", "EXPENSE"];
const signed = (type, debit, credit) =>
  DEBIT_NORMAL.includes(type) ? debit - credit : credit - debit;

const select = {
  id: true,
  code: true,
  name: true,
  type: true,
  parentId: true,
  isGroup: true,
  isActive: true,
  systemKey: true,
  description: true,
};

/** Debit/credit totals per account up to a date (inclusive). */
async function totalsByAccount(where) {
  const rows = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where,
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((r) => [
      r.accountId,
      { debit: toPaisa(r._sum.debit ?? 0), credit: toPaisa(r._sum.credit ?? 0) },
    ]),
  );
}

/**
 * The chart, ordered by code. With `balances`, each account carries its balance (in its normal
 * direction) and each group the sum of the accounts under it.
 */
const list = async (query) => {
  const accounts = await prisma.account.findMany({
    where: {
      ...(query.postable && { isGroup: false, isActive: true }),
      ...(query.type && { type: query.type }),
    },
    orderBy: { code: "asc" },
    select,
  });
  if (!query.balances) return accounts;

  const totals = await totalsByAccount({ entry: { date: { lte: query.asOf ?? dhakaDate() } } });
  const all = query.postable ? await prisma.account.findMany({ select }) : accounts;
  const children = new Map();
  for (const a of all) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const balanceOf = (account) => {
    if (!account.isGroup) {
      const t = totals.get(account.id) ?? { debit: 0n, credit: 0n };
      return signed(account.type, t.debit, t.credit);
    }
    return (children.get(account.id) ?? []).reduce((sum, child) => sum + balanceOf(child), 0n);
  };
  return accounts.map((a) => ({ ...a, balance: fromPaisa(balanceOf(a)) }));
};

const findAccount = async (id) => {
  const account = await prisma.account.findUnique({ where: { id }, select });
  if (!account) throw AppError.notFound("Account not found");
  return account;
};

const assertCodeFree = async (code, exceptId) => {
  const clash = await prisma.account.findFirst({
    where: { code, ...(exceptId && { id: { not: exceptId } }) },
  });
  if (clash)
    throw AppError.conflict(`Code ${code} is ${clash.name}`, [
      { path: "code", message: "Already used" },
    ]);
};

const create = async (actor, { parentId, type, ...data }) => {
  await assertCodeFree(data.code);
  let accountType = type;
  if (parentId) {
    const parent = await findAccount(parentId);
    if (!parent.isGroup) throw invalid("parentId", `${parent.code} ${parent.name} isn't a group`);
    accountType = parent.type;
  } else if (!type) {
    throw invalid("type", "Choose the type of a top-level account");
  }
  const account = await prisma.account.create({
    data: { ...data, type: accountType, parentId: parentId ?? null, createdById: actor.userId },
  });
  return findAccount(account.id);
};

const update = async (actor, id, data) => {
  const account = await findAccount(id);
  if (data.code && data.code !== account.code) await assertCodeFree(data.code, id);
  if (data.isActive === false && account.systemKey) {
    throw invalid("isActive", "Automatic postings use this account; it can't be switched off");
  }
  await prisma.account.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return findAccount(id);
};

/** Only accounts never posted to, without sub-accounts, and not used by automatic postings. */
const remove = async (id) => {
  const account = await findAccount(id);
  if (account.systemKey) throw AppError.conflict("Automatic postings use this account");
  const [lines, kids] = await Promise.all([
    prisma.journalLine.count({ where: { accountId: id } }),
    prisma.account.count({ where: { parentId: id } }),
  ]);
  if (lines) throw AppError.conflict("This account has postings. Switch it off instead.");
  if (kids) throw AppError.conflict("Move or delete the accounts under it first");
  await prisma.account.delete({ where: { id } });
};

/** Lines of one account in a period, with the opening balance and a running balance. */
const ledger = async (id, { from, to }) => {
  const account = await findAccount(id);
  if (account.isGroup)
    throw invalid("id", "A group has no ledger of its own; open an account under it");
  const end = to ?? dhakaDate();
  const [opening, lines] = await Promise.all([
    from
      ? prisma.journalLine.aggregate({
          where: { accountId: id, entry: { date: { lt: from } } },
          _sum: { debit: true, credit: true },
        })
      : null,
    prisma.journalLine.findMany({
      where: { accountId: id, entry: { date: { ...(from && { gte: from }), lte: end } } },
      orderBy: [{ entry: { date: "asc" } }, { entry: { entryNo: "asc" } }, { lineNo: "asc" }],
      select: {
        id: true,
        debit: true,
        credit: true,
        description: true,
        entry: { select: { id: true, entryNo: true, date: true, narration: true, kind: true } },
      },
    }),
  ]);
  let balance = opening
    ? signed(account.type, toPaisa(opening._sum.debit ?? 0), toPaisa(opening._sum.credit ?? 0))
    : 0n;
  const openingBalance = balance;
  let debit = 0n;
  let credit = 0n;
  const rows = lines.map((line) => {
    const d = toPaisa(line.debit);
    const c = toPaisa(line.credit);
    debit += d;
    credit += c;
    balance += signed(account.type, d, c);
    return { ...line, balance: fromPaisa(balance) };
  });
  return {
    account,
    from: from ?? null,
    to: end,
    openingBalance: fromPaisa(openingBalance),
    totalDebit: fromPaisa(debit),
    totalCredit: fromPaisa(credit),
    closingBalance: fromPaisa(balance),
    lines: rows,
  };
};

/** Every account with postings up to `asOf`, as a debit or credit balance; totals must agree. */
const trialBalance = async ({ asOf }) => {
  const date = asOf ?? dhakaDate();
  const totals = await totalsByAccount({ entry: { date: { lte: date } } });
  const accounts = await prisma.account.findMany({
    where: { id: { in: [...totals.keys()] } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  let debit = 0n;
  let credit = 0n;
  const rows = accounts
    .map((account) => {
      const t = totals.get(account.id);
      const net = t.debit - t.credit;
      if (net > 0n) debit += net;
      else credit -= net;
      return {
        ...account,
        debit: fromPaisa(net > 0n ? net : 0n),
        credit: fromPaisa(net < 0n ? -net : 0n),
      };
    })
    .filter((r) => r.debit !== "0.00" || r.credit !== "0.00");
  return {
    asOf: date,
    rows,
    totalDebit: fromPaisa(debit),
    totalCredit: fromPaisa(credit),
    balanced: debit === credit,
  };
};

export const AccountService = {
  list,
  getById: findAccount,
  create,
  update,
  remove,
  ledger,
  trialBalance,
};

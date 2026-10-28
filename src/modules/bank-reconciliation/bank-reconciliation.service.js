import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { moneyAccounts } from "#modules/account/account.statements.js";
import { postEntry } from "#modules/journal/journal.posting.js";

/**
 * Bank reconciliation: statements imported per bank (or mobile) account, each line matched to
 * one journal line on that account. The summary ties the books to the bank:
 *   book balance − book lines not yet on a statement + statement lines not yet in the books
 *     = the statement's closing balance
 * It is reconciled when that holds and no statement line is left to put in the books.
 */

const MATCH_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/** Accounts that get bank statements: money accounts other than cash in hand. */
const accounts = async () => (await moneyAccounts()).filter((a) => a.systemKey !== "CASH");

async function bankAccount(id) {
  const account = (await accounts()).find((a) => a.id === id);
  if (!account) throw invalid("accountId", "Choose a bank or mobile account");
  return account;
}

const journalLineSelect = {
  id: true,
  debit: true,
  credit: true,
  description: true,
  entry: { select: { id: true, entryNo: true, date: true, narration: true } },
};

/** + money in, − money out, as on a bank statement. */
const signedOf = (line) => toPaisa(line.debit) - toPaisa(line.credit);

const words = (text) =>
  new Set(
    (text ?? "")
      .toUpperCase()
      .split(/[^A-Z0-9-]+/)
      .filter((w) => w.length >= 4 && /\d/.test(w)),
  );

/**
 * Matches the account's unmatched statement lines to unreconciled book lines of the same amount
 * within a few days; a shared reference (cheque or transaction number) wins, then the nearest date.
 */
async function autoMatch(tx, accountId, actor) {
  const open = await tx.bankStatementLine.findMany({
    where: { accountId, status: "UNMATCHED" },
    orderBy: { date: "asc" },
  });
  if (!open.length) return 0;
  const first = open[0].date;
  const last = open.at(-1).date;
  const book = await tx.journalLine.findMany({
    where: {
      accountId,
      statement: null,
      entry: {
        date: {
          gte: new Date(first.getTime() - MATCH_DAYS * DAY_MS),
          lte: new Date(last.getTime() + MATCH_DAYS * DAY_MS),
        },
      },
    },
    select: journalLineSelect,
  });
  const taken = new Set();
  let matched = 0;
  for (const line of open) {
    const amount = toPaisa(line.amount);
    const refs = words(`${line.reference ?? ""} ${line.description}`);
    const best = book
      .filter((b) => !taken.has(b.id) && signedOf(b) === amount)
      .map((b) => {
        const days = Math.abs(b.entry.date - line.date) / DAY_MS;
        const text = words(`${b.entry.narration} ${b.description ?? ""}`);
        const shared = [...refs].some((w) => text.has(w));
        return { b, days, shared };
      })
      .filter((c) => c.days <= MATCH_DAYS)
      .sort((x, y) => Number(y.shared) - Number(x.shared) || x.days - y.days)[0];
    if (!best) continue;
    taken.add(best.b.id);
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: "MATCHED",
        journalLineId: best.b.id,
        autoMatched: true,
        matchedAt: new Date(),
        matchedById: actor?.userId ?? null,
      },
    });
    matched += 1;
  }
  return matched;
}

const importStatement = async (actor, { accountId, fileName, closingBalance, lines }) => {
  const account = await bankAccount(accountId);
  const dates = lines.map((l) => l.date.getTime());
  const fromDate = new Date(Math.min(...dates));
  const toDate = new Date(Math.max(...dates));
  // Lines already imported (same day, amount and text) are skipped, so a re-export is safe
  const existing = await prisma.bankStatementLine.findMany({
    where: { accountId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, amount: true, description: true },
  });
  const key = (l) =>
    `${l.date.toISOString().slice(0, 10)}|${toPaisa(l.amount)}|${l.description.trim()}`;
  const seen = new Set(existing.map(key));
  const fresh = lines.filter((l) => {
    const k = key(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length)
    throw AppError.conflict("Every line in this file was already imported for this account");
  const result = await prisma.$transaction(async (tx) => {
    const statement = await tx.bankStatement.create({
      data: {
        accountId,
        fileName: fileName ?? null,
        fromDate,
        toDate,
        closingBalance,
        createdById: actor.userId,
      },
    });
    await tx.bankStatementLine.createMany({
      data: fresh.map((l) => ({
        statementId: statement.id,
        accountId,
        date: l.date,
        description: l.description,
        reference: l.reference ?? null,
        amount: l.amount,
      })),
    });
    const matched = await autoMatch(tx, accountId, actor);
    await recordAudit(
      {
        action: "BANK_STATEMENT_IMPORTED",
        entityType: "Account",
        entityId: accountId,
        description: `${account.code} ${account.name}: ${fresh.length} lines imported (${lines.length - fresh.length} already there), ${matched} matched`,
      },
      tx,
    );
    return { statement, matched };
  });
  return {
    ...(await getStatement(result.statement.id)),
    imported: fresh.length,
    duplicates: lines.length - fresh.length,
    autoMatched: result.matched,
  };
};

/** Where the account stands against a statement: the reconciliation summary. */
async function summaryFor(statement) {
  const { accountId, toDate } = statement;
  const start = await prisma.bankStatement.aggregate({
    where: { accountId },
    _min: { fromDate: true },
  });
  const since = start._min.fromDate ?? statement.fromDate;
  const [book, uncleared, unbooked] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { accountId, entry: { date: { lte: toDate } } },
      _sum: { debit: true, credit: true },
    }),
    // Book lines since reconciling began that no statement shows yet
    prisma.journalLine.findMany({
      where: { accountId, statement: null, entry: { date: { gte: since, lte: toDate } } },
      orderBy: { entry: { date: "asc" } },
      select: journalLineSelect,
    }),
    prisma.bankStatementLine.findMany({
      where: { accountId, status: "UNMATCHED", date: { lte: toDate } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, description: true, reference: true, amount: true },
    }),
  ]);
  const bookBalance = toPaisa(book._sum.debit ?? 0) - toPaisa(book._sum.credit ?? 0);
  const notOnStatement = uncleared.reduce((sum, l) => sum + signedOf(l), 0n);
  const notInBooks = unbooked.reduce((sum, l) => sum + toPaisa(l.amount), 0n);
  const adjusted = bookBalance - notOnStatement + notInBooks;
  const closing = toPaisa(statement.closingBalance);
  return {
    bookBalance: fromPaisa(bookBalance),
    notOnStatement: fromPaisa(notOnStatement),
    notInBooks: fromPaisa(notInBooks),
    adjustedBalance: fromPaisa(adjusted),
    statementBalance: fromPaisa(closing),
    difference: fromPaisa(closing - adjusted),
    // The arithmetic agrees …
    balancesTie: closing === adjusted,
    // … and every statement line is matched or ignored (nothing left to put in the books)
    reconciled: closing === adjusted && unbooked.length === 0,
    uncleared: uncleared.map((l) => ({ ...l, amount: fromPaisa(signedOf(l)) })),
    unbooked,
  };
}

const getStatement = async (id) => {
  const statement = await prisma.bankStatement.findUnique({
    where: { id },
    include: {
      account: {
        select: { id: true, code: true, name: true, bankName: true, accountNumber: true },
      },
      lines: {
        orderBy: [{ date: "asc" }, { id: "asc" }],
        include: { journalLine: { select: journalLineSelect } },
      },
    },
  });
  if (!statement) throw AppError.notFound("Statement not found");
  const counts = { MATCHED: 0, UNMATCHED: 0, IGNORED: 0 };
  for (const l of statement.lines) counts[l.status] += 1;
  return { ...statement, counts, summary: await summaryFor(statement) };
};

const list = async ({ accountId }) => {
  const statements = await prisma.bankStatement.findMany({
    where: accountId ? { accountId } : {},
    orderBy: [{ toDate: "desc" }, { createdAt: "desc" }],
    include: {
      account: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
  });
  const open = await prisma.bankStatementLine.groupBy({
    by: ["statementId"],
    where: { statementId: { in: statements.map((s) => s.id) }, status: "UNMATCHED" },
    _count: { _all: true },
  });
  return statements.map(({ _count, ...s }) => ({
    ...s,
    lineCount: _count.lines,
    unmatched: open.find((o) => o.statementId === s.id)?._count._all ?? 0,
  }));
};

const removeStatement = async (id) => {
  const statement = await prisma.bankStatement.findUnique({ where: { id } });
  if (!statement) throw AppError.notFound("Statement not found");
  await prisma.bankStatement.delete({ where: { id } });
};

async function findLine(id) {
  const line = await prisma.bankStatementLine.findUnique({ where: { id } });
  if (!line) throw AppError.notFound("Statement line not found");
  return line;
}

/** Unreconciled book lines of the same amount, nearest date first. */
const candidates = async (id) => {
  const line = await findLine(id);
  const book = await prisma.journalLine.findMany({
    where: {
      accountId: line.accountId,
      statement: null,
      ...(toPaisa(line.amount) > 0n
        ? { debit: line.amount }
        : { credit: fromPaisa(-toPaisa(line.amount)) }),
    },
    select: journalLineSelect,
    take: 50,
  });
  return book
    .map((b) => ({
      ...b,
      amount: fromPaisa(signedOf(b)),
      days: Math.round(Math.abs(b.entry.date - line.date) / DAY_MS),
    }))
    .sort((a, b) => a.days - b.days);
};

const match = async (actor, id, { journalLineId }) => {
  const line = await findLine(id);
  if (line.status === "MATCHED") throw AppError.conflict("This line is already matched");
  const book = await prisma.journalLine.findUnique({
    where: { id: journalLineId },
    select: { ...journalLineSelect, accountId: true, statement: { select: { id: true } } },
  });
  if (!book || book.accountId !== line.accountId)
    throw invalid("journalLineId", "Choose a book entry on the same account");
  if (book.statement) throw AppError.conflict("That entry is matched to another statement line");
  if (signedOf(book) !== toPaisa(line.amount)) throw invalid("journalLineId", "The amounts differ");
  await prisma.bankStatementLine.update({
    where: { id },
    data: {
      status: "MATCHED",
      journalLineId,
      autoMatched: false,
      matchedAt: new Date(),
      matchedById: actor.userId,
    },
  });
  return getStatement(line.statementId);
};

const unmatch = async (id) => {
  const line = await findLine(id);
  await prisma.bankStatementLine.update({
    where: { id },
    data: {
      status: "UNMATCHED",
      journalLineId: null,
      autoMatched: false,
      matchedAt: null,
      matchedById: null,
    },
  });
  return getStatement(line.statementId);
};

const ignore = async (actor, id, { ignored }) => {
  const line = await findLine(id);
  if (line.status === "MATCHED") throw AppError.conflict("Unmatch the line first");
  await prisma.bankStatementLine.update({
    where: { id },
    data: { status: ignored ? "IGNORED" : "UNMATCHED", matchedById: actor.userId },
  });
  return getStatement(line.statementId);
};

/**
 * Books a statement line the books don't have yet (bank charges, interest, a direct deposit):
 * posts it between the bank account and `accountId`, and matches it.
 */
const book = async (actor, id, { accountId, narration }) => {
  const line = await findLine(id);
  if (line.status !== "UNMATCHED") throw AppError.conflict("Only an unmatched line can be booked");
  if (accountId === line.accountId)
    throw invalid("accountId", "Choose the other side of the entry");
  const amount = toPaisa(line.amount);
  await prisma.$transaction(async (tx) => {
    const entry = await postEntry(tx, {
      date: line.date,
      narration:
        narration ??
        `Bank statement: ${line.description}${line.reference ? ` (${line.reference})` : ""}`,
      kind: "AUTO",
      sourceType: "BankStatementLine",
      sourceId: line.id,
      actor,
      lines:
        amount > 0n
          ? [
              { accountId: line.accountId, debit: fromPaisa(amount) },
              { accountId, credit: fromPaisa(amount) },
            ]
          : [
              { accountId, debit: fromPaisa(-amount) },
              { accountId: line.accountId, credit: fromPaisa(-amount) },
            ],
    });
    const bankLine = await tx.journalLine.findFirst({
      where: { entryId: entry.id, accountId: line.accountId },
    });
    await tx.bankStatementLine.update({
      where: { id },
      data: {
        status: "MATCHED",
        journalLineId: bankLine.id,
        autoMatched: false,
        matchedAt: new Date(),
        matchedById: actor.userId,
      },
    });
  });
  return getStatement(line.statementId);
};

export const BankReconciliationService = {
  accounts,
  list,
  getStatement,
  importStatement,
  removeStatement,
  candidates,
  match,
  unmatch,
  ignore,
  book,
};

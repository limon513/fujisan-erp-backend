import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import logger from "#core/utils/logger.js";
import { dhakaDate } from "#core/utils/time.js";
import {
  postEntry,
  postPaymentReversed,
  postPaymentVerified,
  postRegistration,
  reverseEntry,
} from "./journal.posting.js";

const userSelect = {
  select: { id: true, username: true, employee: { select: { fullName: true } } },
};

const entrySelect = {
  id: true,
  entryNo: true,
  date: true,
  narration: true,
  kind: true,
  sourceType: true,
  sourceId: true,
  reversesId: true,
  createdAt: true,
  fiscalYear: { select: { id: true, name: true, status: true } },
  reverses: { select: { id: true, entryNo: true } },
  reversedBy: { select: { id: true, entryNo: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      bookingId: true,
      account: { select: { id: true, code: true, name: true } },
    },
  },
};

const withTotal = (entry) => ({
  ...entry,
  total: fromPaisa(entry.lines.reduce((sum, l) => sum + toPaisa(l.debit), 0n)),
});

/** Frontend path of the record behind an automatic entry. */
const sourceLink = (entry) =>
  entry.sourceType === "Payment"
    ? `/collections/${entry.sourceId}`
    : entry.sourceType === "Booking"
      ? `/bookings/${entry.sourceId}`
      : null;

const list = async (query) => {
  const where = {
    AND: [
      query.kind ? { kind: query.kind } : {},
      query.accountId ? { lines: { some: { accountId: query.accountId } } } : {},
      query.from || query.to
        ? { date: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) } }
        : {},
      query.search
        ? {
            OR: [
              { entryNo: { contains: query.search, mode: "insensitive" } },
              { narration: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.journalEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { entryNo: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: entrySelect,
    }),
    prisma.journalEntry.count({ where }),
  ]);
  return {
    data: rows.map((e) => ({ ...withTotal(e), link: sourceLink(e) })),
    meta: paginationMeta(query, total),
  };
};

const getById = async (id) => {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    select: { ...entrySelect, createdById: true },
  });
  if (!entry) throw AppError.notFound("Journal entry not found");
  const { createdById, ...rest } = entry;
  const user = createdById
    ? await prisma.user.findUnique({ where: { id: createdById }, ...userSelect })
    : null;
  return {
    ...withTotal(rest),
    link: sourceLink(rest),
    createdBy: user ? { id: user.id, name: user.employee?.fullName ?? user.username } : null,
  };
};

/** Manual journal (adjustments, expenses, opening balances). Posted at once; reverse to undo. */
const create = async (actor, { date, narration, lines }) => {
  const entry = await prisma.$transaction(async (tx) => {
    const posted = await postEntry(tx, { date, narration, kind: "MANUAL", lines, actor });
    await recordAudit(
      {
        action: "JOURNAL_POSTED",
        entityType: "JournalEntry",
        entityId: posted.id,
        description: `Posted ${posted.entryNo}: ${narration}`,
      },
      tx,
    );
    return posted;
  });
  return getById(entry.id);
};

/** Reverses a manual entry. Automatic ones are undone from their record (e.g. reverse the payment). */
const reverse = async (actor, id, { date, reason }) => {
  const original = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!original) throw AppError.notFound("Journal entry not found");
  if (original.kind === "AUTO") {
    throw AppError.conflict("Undo an automatic entry from its record (e.g. reverse the payment)");
  }
  const reversal = await prisma.$transaction(async (tx) => {
    const posted = await reverseEntry(tx, original, {
      date: date ?? dhakaDate(),
      narration: `Reversal of ${original.entryNo}: ${reason}`,
      actor,
    });
    await recordAudit(
      {
        action: "JOURNAL_REVERSED",
        entityType: "JournalEntry",
        entityId: original.id,
        description: `Reversed ${original.entryNo} by ${posted.entryNo}: ${reason}`,
      },
      tx,
    );
    return posted;
  });
  return getById(reversal.id);
};

/**
 * Posts what happened before accounting existed (verified / reversed payments, registrations), once.
 * Idempotent: an entry exists at most once per record and kind.
 */
const backfill = async () => {
  const posted = (sourceType, kind) =>
    prisma.journalEntry
      .findMany({ where: { sourceType, kind }, select: { sourceId: true } })
      .then((rows) => new Set(rows.map((r) => r.sourceId)));
  const [paymentsPosted, reversalsPosted, bookingsPosted] = await Promise.all([
    posted("Payment", "AUTO"),
    posted("Payment", "REVERSAL"),
    posted("Booking", "AUTO"),
  ]);
  let count = 0;
  const payments = await prisma.payment.findMany({
    where: { status: { in: ["VERIFIED", "REVERSED"] } },
    orderBy: { verifiedAt: "asc" },
    select: { id: true, status: true },
  });
  for (const payment of payments) {
    if (!paymentsPosted.has(payment.id)) {
      await prisma.$transaction((tx) => postPaymentVerified(tx, payment.id, null));
      count += 1;
    }
    if (payment.status === "REVERSED" && !reversalsPosted.has(payment.id)) {
      await prisma.$transaction((tx) => postPaymentReversed(tx, payment.id, null));
      count += 1;
    }
  }
  const registered = await prisma.booking.findMany({
    where: { status: "REGISTERED" },
    select: { id: true },
  });
  for (const booking of registered) {
    if (bookingsPosted.has(booking.id)) continue;
    await prisma.$transaction((tx) => postRegistration(tx, booking.id, null));
    count += 1;
  }
  if (count) logger.info({ count }, "Accounting backfill posted entries");
  return count;
};

export const JournalService = { list, getById, create, reverse, backfill };

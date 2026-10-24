import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { buildScopeWhere } from "#core/rbac/scope.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import logger from "#core/utils/logger.js";
import { daysBetween, dhakaDate, monthOf } from "#core/utils/time.js";
import { statusFor } from "#modules/booking/booking.ledger.js";
import { notifyEmployee } from "#modules/lead/lead.workflow.js";
import { lateFeeFor } from "#modules/payment-plan/payment-plan.schedule.js";

const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;
const LIVE = ["CONFIRMED", "REGISTERED"];
const UNPAID = ["DUE", "PARTIAL"];
/** Reminders go out this many days before the due date. */
const REMINDER_DAYS = [7, 3, 1];

const installmentSelect = {
  id: true,
  number: true,
  kind: true,
  dueDate: true,
  amount: true,
  lateFee: true,
  paidAmount: true,
  status: true,
  paidAt: true,
  lateFeeAppliedAt: true,
  lateFeeWaivedReason: true,
  booking: {
    select: {
      id: true,
      bookingNo: true,
      plot: { select: { code: true } },
      project: { select: { id: true, name: true } },
      customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
      owner: { select: { id: true, fullName: true } },
    },
  },
};

const owed = (i) => toPaisa(i.amount) + toPaisa(i.lateFee) - toPaisa(i.paidAmount);
const toDto = (i) => ({ ...i, outstanding: fromPaisa(owed(i)) });

/** Installments of live bookings inside the actor's scope (by the booking's sales executive). */
const baseWhere = ({ actor, scope }, query = {}) => ({
  booking: {
    status: { in: LIVE },
    AND: [
      buildScopeWhere(actor, scope),
      query.projectId ? { projectId: query.projectId } : {},
      query.bookingId ? { id: query.bookingId } : {},
      query.search
        ? {
            OR: [
              { bookingNo: { contains: query.search, mode: "insensitive" } },
              { customer: { fullName: { contains: query.search, mode: "insensitive" } } },
              { plot: { code: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  },
});

function whenWhere(when, today) {
  const { end } = monthOf(today);
  switch (when) {
    case "overdue":
      return { status: { in: UNPAID }, dueDate: { lt: today } };
    case "month":
      return { status: { in: UNPAID }, dueDate: { gte: today, lt: end } };
    case "upcoming":
      return { status: { in: UNPAID }, dueDate: { gte: end } };
    case "paid":
      return { status: "PAID" };
    default:
      return {};
  }
}

const list = async (access, query) => {
  const today = dhakaDate();
  const where = { AND: [baseWhere(access, query), whenWhere(query.when, today)] };
  const [rows, total] = await prisma.$transaction([
    prisma.installment.findMany({
      where,
      orderBy: [{ dueDate: query.when === "paid" ? "desc" : "asc" }, { number: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: installmentSelect,
    }),
    prisma.installment.count({ where }),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(query, total) };
};

/** Overdue, due this month and collected this month (verified payments), within scope. */
const summary = async (access) => {
  const today = dhakaDate();
  const { start, end } = monthOf(today);
  const base = baseWhere(access);
  const totals = async (when) => {
    const rows = await prisma.installment.findMany({
      where: { AND: [base, whenWhere(when, today)] },
      select: { amount: true, lateFee: true, paidAmount: true, bookingId: true },
    });
    return {
      count: rows.length,
      amount: fromPaisa(rows.reduce((sum, i) => sum + owed(i), 0n)),
      bookings: new Set(rows.map((i) => i.bookingId)).size,
    };
  };
  const [overdue, month, collected] = await Promise.all([
    totals("overdue"),
    totals("month"),
    prisma.payment.aggregate({
      where: { status: "VERIFIED", paidOn: { gte: start, lt: end }, booking: base.booking },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return {
    overdue,
    dueThisMonth: month,
    collectedThisMonth: {
      count: collected._count,
      amount: fromPaisa(toPaisa(collected._sum.amount ?? 0)),
    },
  };
};

/** Drops an installment's late fee (keeping any part of it already paid). */
const waiveLateFee = async (access, id, { reason }) => {
  const installment = await prisma.installment.findFirst({
    where: { id, ...baseWhere(access) },
    select: { ...installmentSelect, bookingId: true },
  });
  if (!installment) throw AppError.notFound("Installment not found");
  if (toPaisa(installment.lateFee) === 0n) throw AppError.conflict("There is no late fee to waive");

  const paidOverAmount = toPaisa(installment.paidAmount) - toPaisa(installment.amount);
  const lateFee = paidOverAmount > 0n ? paidOverAmount : 0n;
  await prisma.$transaction(async (tx) => {
    await tx.installment.update({
      where: { id },
      data: {
        lateFee: fromPaisa(lateFee),
        lateFeeWaivedReason: reason,
        status: statusFor(installment.amount, fromPaisa(lateFee), toPaisa(installment.paidAmount)),
      },
    });
    await recordAudit(
      {
        action: "LATE_FEE_WAIVED",
        entityType: "Booking",
        entityId: installment.bookingId,
        description: `Waived the ${taka(installment.lateFee)} late fee on installment ${installment.number} of ${installment.booking.bookingNo}: ${reason}`,
      },
      tx,
    );
  });
  const updated = await prisma.installment.findUnique({ where: { id }, select: installmentSelect });
  return toDto(updated);
};

/**
 * Daily job (safe to run often): adds the plan's late fee once to installments past their due
 * date plus grace period, and reminds the sales executive 7, 3 and 1 days before a due date and
 * when it becomes overdue. Every write is conditional, so repeated or parallel runs do nothing new.
 */
const runDaily = async (now = new Date()) => {
  const today = dhakaDate(now);
  const candidates = await prisma.installment.findMany({
    where: {
      status: { in: UNPAID },
      dueDate: { lte: new Date(today.getTime() + 7 * 86_400_000) },
      booking: { status: { in: LIVE } },
    },
    select: {
      id: true,
      number: true,
      dueDate: true,
      amount: true,
      lateFee: true,
      paidAmount: true,
      lateFeeAppliedAt: true,
      reminderDays: true,
      booking: {
        select: {
          id: true,
          bookingNo: true,
          ownerId: true,
          planTerms: true,
          customer: { select: { fullName: true } },
        },
      },
    },
    take: 2000,
  });

  let fees = 0;
  let reminders = 0;
  for (const i of candidates) {
    const days = daysBetween(today, i.dueDate);
    const terms = i.booking.planTerms;

    // Late fee: once, after the grace period
    if (!i.lateFeeAppliedAt && -days > Number(terms.gracePeriodDays ?? 0)) {
      const fee = lateFeeFor(terms, i.amount);
      const { count } = await prisma.installment.updateMany({
        where: { id: i.id, lateFeeAppliedAt: null },
        data: {
          lateFee: fee,
          lateFeeAppliedAt: now,
          status: statusFor(i.amount, fee, toPaisa(i.paidAmount)),
        },
      });
      if (count && toPaisa(fee) > 0n) fees += 1;
    }

    // Reminder: the tightest threshold reached that wasn't sent yet (0 = overdue notice)
    const threshold = days < 0 ? 0 : REMINDER_DAYS.filter((t) => days <= t).at(-1);
    if (threshold === undefined || (i.reminderDays != null && i.reminderDays <= threshold))
      continue;
    const { count } = await prisma.installment.updateMany({
      where: {
        id: i.id,
        OR: [{ reminderDays: null }, { reminderDays: { gt: threshold } }],
      },
      data: { reminderDays: threshold },
    });
    if (!count) continue;
    const amount = taka(fromPaisa(owed(i)));
    const label = i.number === 0 ? "Down payment" : `Installment ${i.number}`;
    await notifyEmployee(prisma, null, i.booking.ownerId, {
      type: threshold === 0 ? "INSTALLMENT_OVERDUE" : "INSTALLMENT_DUE",
      title:
        threshold === 0
          ? `Overdue: ${i.booking.customer.fullName} · ${amount}`
          : `Due in ${days === 0 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`}: ${i.booking.customer.fullName} · ${amount}`,
      body: `${label} of ${i.booking.bookingNo}`,
      link: `/bookings/${i.booking.id}`,
    });
    reminders += 1;
  }
  if (fees || reminders) logger.info({ fees, reminders }, "EMI daily run");
  return { fees, reminders };
};

export const EmiService = { list, summary, waiveLateFee, runDaily };

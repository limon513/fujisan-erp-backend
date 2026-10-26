import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { buildScopeWhere } from "#core/rbac/scope.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import { daysBetween, dhakaDate, monthOf } from "#core/utils/time.js";
import { balanceOf } from "#modules/booking/booking.ledger.js";

/**
 * Read-only sales, collection and receivable figures. Everything follows the `report.view` scope
 * by the booking's sales executive (+ org), stamped on bookings and payments alike.
 */

const LIVE = ["CONFIRMED", "REGISTERED"];
const AGING = [
  { key: "current", label: "Not yet due", min: -Infinity, max: 0 },
  { key: "d1_30", label: "1–30 days", min: 1, max: 30 },
  { key: "d31_60", label: "31–60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61–90 days", min: 61, max: 90 },
  { key: "d90", label: "Over 90 days", min: 91, max: Infinity },
];

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);
const sum = (rows, pick) => rows.reduce((total, row) => total + toPaisa(pick(row) ?? 0), 0n);
const DAY_MS = 24 * 60 * 60 * 1000;
const monthKey = (date) => date.toISOString().slice(0, 7);

/** The period asked for, default this month to date (date-only, inclusive). */
function periodOf({ from, to }) {
  const today = dhakaDate();
  return { from: from ?? monthOf(today).start, to: to ?? today };
}

/** Adds money into a keyed bucket: { key → { ...meta, count, amount (paisa) } }. */
function tally(map, key, amount, meta = {}) {
  const row = map.get(key) ?? { ...meta, count: 0, amount: 0n };
  row.count += 1;
  row.amount += amount;
  map.set(key, row);
}
const rowsOf = (map) =>
  [...map.values()]
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((row) => ({ ...row, amount: fromPaisa(row.amount) }));

/** What an installment still owes; waived ones owe nothing. */
const owedOf = (i) =>
  i.status === "WAIVED" ? 0n : toPaisa(i.amount) + toPaisa(i.lateFee) - toPaisa(i.paidAmount);

function agingOf(installments, today) {
  const buckets = Object.fromEntries(AGING.map((b) => [b.key, 0n]));
  let oldestDue = null;
  let nextDue = null;
  for (const i of installments) {
    const owed = owedOf(i);
    if (owed <= 0n) continue;
    const late = daysBetween(i.dueDate, today);
    buckets[AGING.find((b) => late >= b.min && late <= b.max).key] += owed;
    if (late > 0 && (!oldestDue || i.dueDate < oldestDue)) oldestDue = i.dueDate;
    if (late <= 0 && (!nextDue || i.dueDate < nextDue.dueDate))
      nextDue = { dueDate: i.dueDate, amount: fromPaisa(owed) };
  }
  return { buckets, oldestDue, nextDue };
}

// ---- Overview (dashboard) -------------------------------------------------------------------

/** This month at a glance, the last 12 months of sales vs collections, and receivables aging. */
const overview = async (access) => {
  const today = dhakaDate();
  const month = monthOf(today);
  const since = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const scope = scopeWhere(access);

  const [booked, collected, live, pendingPayments, registrations, cancellations] =
    await Promise.all([
      prisma.booking.findMany({
        where: { AND: [scope], confirmedAt: { not: null }, bookingDate: { gte: since } },
        select: { bookingDate: true, netPrice: true },
      }),
      prisma.payment.findMany({
        where: { AND: [scope], status: "VERIFIED", paidOn: { gte: since } },
        select: { paidOn: true, amount: true },
      }),
      prisma.booking.findMany({
        where: { AND: [scope], status: { in: LIVE } },
        select: {
          installments: {
            select: { dueDate: true, amount: true, lateFee: true, paidAmount: true, status: true },
          },
        },
      }),
      prisma.payment.aggregate({
        where: { AND: [scope], status: "PENDING" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.booking.count({
        where: { AND: [scope], registeredOn: { gte: month.start, lt: month.end } },
      }),
      prisma.cancellation.count({
        where: { AND: [scope], approvedAt: { gte: new Date(month.start.getTime() - 6 * 3600e3) } },
      }),
    ]);

  const months = [];
  for (let k = 0; k < 12; k += 1) {
    const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + k, 1));
    months.push({ month: monthKey(start), booked: 0n, bookings: 0, collected: 0n });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const b of booked) {
    const m = byMonth.get(monthKey(b.bookingDate));
    if (m) {
      m.booked += toPaisa(b.netPrice);
      m.bookings += 1;
    }
  }
  for (const p of collected) {
    const m = byMonth.get(monthKey(p.paidOn));
    if (m) m.collected += toPaisa(p.amount);
  }
  const thisMonth = byMonth.get(monthKey(today));

  const aging = Object.fromEntries(AGING.map((b) => [b.key, 0n]));
  let outstanding = 0n;
  let dueNext30 = 0n;
  const in30 = new Date(today.getTime() + 30 * DAY_MS);
  for (const booking of live) {
    const { buckets } = agingOf(booking.installments, today);
    for (const [key, value] of Object.entries(buckets)) aging[key] += value;
    for (const i of booking.installments) {
      const owed = owedOf(i);
      outstanding += owed;
      if (owed > 0n && i.dueDate >= today && i.dueDate <= in30) dueNext30 += owed;
    }
  }
  const overdue = Object.entries(aging)
    .filter(([key]) => key !== "current")
    .reduce((total, [, value]) => total + value, 0n);

  return {
    thisMonth: {
      month: thisMonth.month,
      bookings: thisMonth.bookings,
      booked: fromPaisa(thisMonth.booked),
      collected: fromPaisa(thisMonth.collected),
      registrations,
      cancellations,
      pendingPayments: {
        count: pendingPayments._count._all,
        amount: (pendingPayments._sum.amount ?? 0).toString(),
      },
    },
    trend: months.map((m) => ({
      month: m.month,
      bookings: m.bookings,
      booked: fromPaisa(m.booked),
      collected: fromPaisa(m.collected),
    })),
    receivables: {
      outstanding: fromPaisa(outstanding),
      overdue: fromPaisa(overdue),
      dueNext30: fromPaisa(dueNext30),
      aging: AGING.map((b) => ({ key: b.key, label: b.label, amount: fromPaisa(aging[b.key]) })),
    },
  };
};

// ---- Sales ----------------------------------------------------------------------------------

const sales = async (access, query) => {
  const { from, to } = periodOf(query);
  const scope = scopeWhere(access);
  const project = query.projectId ? { projectId: query.projectId } : {};
  const inPeriod = { gte: from, lte: to };
  const [bookings, registered, cancelled, transfers] = await Promise.all([
    prisma.booking.findMany({
      where: { AND: [scope, project], confirmedAt: { not: null }, bookingDate: inPeriod },
      orderBy: { bookingDate: "desc" },
      select: {
        id: true,
        bookingNo: true,
        bookingDate: true,
        status: true,
        listPrice: true,
        discountAmount: true,
        netPrice: true,
        plot: { select: { code: true, areaSqft: true } },
        project: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true } },
        owner: { select: { id: true, fullName: true } },
      },
    }),
    prisma.booking.findMany({
      where: { AND: [scope, project], registeredOn: inPeriod },
      select: { netPrice: true },
    }),
    prisma.cancellation.findMany({
      where: {
        AND: [scope],
        booking: project,
        approvedAt: {
          gte: new Date(from.getTime() - 6 * 3600e3),
          lt: new Date(to.getTime() + 18 * 3600e3),
        },
      },
      select: { totalPaid: true, chargeAmount: true, refundAmount: true },
    }),
    prisma.ownershipTransfer.findMany({
      where: { AND: [scope], booking: project, status: "COMPLETED", completedOn: inPeriod },
      select: { feeAmount: true },
    }),
  ]);

  const byProject = new Map();
  const bySalesperson = new Map();
  for (const b of bookings) {
    const value = toPaisa(b.netPrice);
    tally(byProject, b.project.id, value, { id: b.project.id, name: b.project.name });
    const owner = b.owner ?? { id: "none", fullName: "Unassigned" };
    tally(bySalesperson, owner.id, value, { id: owner.id, name: owner.fullName });
  }
  return {
    from,
    to,
    totals: {
      bookings: bookings.length,
      listPrice: fromPaisa(sum(bookings, (b) => b.listPrice)),
      discount: fromPaisa(sum(bookings, (b) => b.discountAmount)),
      netPrice: fromPaisa(sum(bookings, (b) => b.netPrice)),
      areaSqft: bookings.reduce((total, b) => total + Number(b.plot.areaSqft ?? 0), 0),
      registrations: registered.length,
      registeredValue: fromPaisa(sum(registered, (b) => b.netPrice)),
      cancellations: cancelled.length,
      cancellationCharges: fromPaisa(sum(cancelled, (c) => c.chargeAmount)),
      refunds: fromPaisa(sum(cancelled, (c) => c.refundAmount)),
      transfers: transfers.length,
      transferFees: fromPaisa(sum(transfers, (t) => t.feeAmount)),
    },
    byProject: rowsOf(byProject),
    bySalesperson: rowsOf(bySalesperson),
    bookings,
  };
};

// ---- Collections ----------------------------------------------------------------------------

const METHOD_LABELS = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  BKASH: "bKash",
  NAGAD: "Nagad",
  CARD: "Card",
};

const collections = async (access, query) => {
  const { from, to } = periodOf(query);
  const scope = scopeWhere(access);
  const project = query.projectId ? { booking: { projectId: query.projectId } } : {};
  const [payments, due, refunds, pending] = await Promise.all([
    prisma.payment.findMany({
      where: { AND: [scope, project], status: "VERIFIED", paidOn: { gte: from, lte: to } },
      orderBy: { paidOn: "desc" },
      select: {
        id: true,
        receiptNo: true,
        paidOn: true,
        amount: true,
        method: true,
        reference: true,
        allocations: { select: { lateFeePart: true } },
        depositAccount: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, fullName: true } },
        booking: {
          select: {
            id: true,
            bookingNo: true,
            plot: { select: { code: true } },
            project: { select: { id: true, name: true } },
            owner: { select: { id: true, fullName: true } },
          },
        },
      },
    }),
    // What fell due in the period (installments), and how much of it is paid by now
    prisma.installment.findMany({
      where: {
        dueDate: { gte: from, lte: to },
        booking: {
          AND: [scope],
          status: { in: LIVE },
          ...(query.projectId && { projectId: query.projectId }),
        },
      },
      select: { amount: true, paidAmount: true, status: true },
    }),
    prisma.cancellation.findMany({
      where: { AND: [scope], booking: project.booking ?? {}, refundPaidOn: { gte: from, lte: to } },
      select: { refundAmount: true },
    }),
    prisma.payment.aggregate({
      where: { AND: [scope, project], status: "PENDING" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const byMethod = new Map();
  const byAccount = new Map();
  const byProject = new Map();
  const byDay = new Map();
  let lateFees = 0n;
  for (const p of payments) {
    const amount = toPaisa(p.amount);
    lateFees += sum(p.allocations, (a) => a.lateFeePart);
    tally(byMethod, p.method, amount, { key: p.method, name: METHOD_LABELS[p.method] });
    const account = p.depositAccount ?? { id: "none", code: "", name: "Not set" };
    tally(byAccount, account.id, amount, {
      id: account.id,
      name: `${account.code} ${account.name}`.trim(),
    });
    tally(byProject, p.booking.project.id, amount, {
      id: p.booking.project.id,
      name: p.booking.project.name,
    });
    const day = p.paidOn.toISOString().slice(0, 10);
    tally(byDay, day, amount, { date: day });
  }
  const dueTotal = sum(due, (i) => (i.status === "WAIVED" ? i.paidAmount : i.amount));
  const duePaid = sum(due, (i) => i.paidAmount);
  // Columns per day for up to two months, per month beyond that
  const spanDays = daysBetween(from, to) + 1;
  const unit = spanDays <= 62 ? "day" : "month";
  const trend = [];
  if (unit === "day") {
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY_MS)) {
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      trend.push({ date: key, count: row?.count ?? 0, amount: fromPaisa(row?.amount ?? 0n) });
    }
  } else {
    const byMonth = new Map();
    for (const [day, row] of byDay) {
      const key = day.slice(0, 7);
      const m = byMonth.get(key) ?? { count: 0, amount: 0n };
      m.count += row.count;
      m.amount += row.amount;
      byMonth.set(key, m);
    }
    for (
      let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      d <= to;
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    ) {
      const key = monthKey(d);
      const row = byMonth.get(key);
      trend.push({ date: key, count: row?.count ?? 0, amount: fromPaisa(row?.amount ?? 0n) });
    }
  }
  const total = sum(payments, (p) => p.amount);
  return {
    from,
    to,
    totals: {
      collected: fromPaisa(total),
      receipts: payments.length,
      lateFees: fromPaisa(lateFees),
      refundsPaid: fromPaisa(sum(refunds, (c) => c.refundAmount)),
      net: fromPaisa(total - sum(refunds, (c) => c.refundAmount)),
      fellDue: fromPaisa(dueTotal),
      fellDuePaid: fromPaisa(duePaid),
      collectionRate: dueTotal > 0n ? Number((duePaid * 1000n) / dueTotal) / 10 : null,
      pending: {
        count: pending._count._all,
        amount: (pending._sum.amount ?? 0).toString(),
      },
    },
    byMethod: rowsOf(byMethod),
    byAccount: rowsOf(byAccount),
    byProject: rowsOf(byProject),
    trend: { unit, points: trend },
    payments,
  };
};

// ---- Outstanding / aging --------------------------------------------------------------------

const outstanding = async (access, query) => {
  const today = dhakaDate();
  const contains = query.search ? { contains: query.search, mode: "insensitive" } : null;
  const bookings = await prisma.booking.findMany({
    where: {
      AND: [
        scopeWhere(access),
        query.projectId ? { projectId: query.projectId } : {},
        contains
          ? {
              OR: [
                { bookingNo: contains },
                { customer: { fullName: contains } },
                { customer: { mobile: contains } },
                { plot: { code: contains } },
              ],
            }
          : {},
      ],
      status: { in: LIVE },
    },
    select: {
      id: true,
      bookingNo: true,
      status: true,
      totalPayable: true,
      plot: { select: { code: true } },
      project: { select: { id: true, name: true } },
      customer: { select: { id: true, fullName: true, mobile: true } },
      owner: { select: { id: true, fullName: true } },
      installments: {
        select: { dueDate: true, amount: true, lateFee: true, paidAmount: true, status: true },
      },
    },
  });

  const totals = { bookings: 0, outstanding: 0n, overdue: 0n };
  const aging = Object.fromEntries(AGING.map((b) => [b.key, 0n]));
  const rows = [];
  for (const { installments, ...b } of bookings) {
    const balance = balanceOf(installments, today);
    const { buckets, oldestDue, nextDue } = agingOf(installments, today);
    const overdue = toPaisa(balance.overdue);
    if (query.overdueOnly && overdue === 0n) continue;
    if (toPaisa(balance.outstanding) === 0n && !query.overdueOnly) continue;
    totals.bookings += 1;
    totals.outstanding += toPaisa(balance.outstanding);
    totals.overdue += overdue;
    for (const [key, value] of Object.entries(buckets)) aging[key] += value;
    rows.push({
      ...b,
      paid: balance.paid,
      outstanding: balance.outstanding,
      overdue: balance.overdue,
      overdueCount: balance.overdueCount,
      daysLate: oldestDue ? daysBetween(oldestDue, today) : 0,
      oldestDue,
      nextDue,
      aging: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, fromPaisa(v)])),
    });
  }
  rows.sort(
    (a, b) =>
      Number(toPaisa(b.overdue) - toPaisa(a.overdue)) ||
      Number(toPaisa(b.outstanding) - toPaisa(a.outstanding)),
  );
  const start = (query.page - 1) * query.limit;
  return {
    data: rows.slice(start, start + query.limit),
    meta: paginationMeta(query, rows.length),
    totals: {
      bookings: totals.bookings,
      outstanding: fromPaisa(totals.outstanding),
      overdue: fromPaisa(totals.overdue),
      aging: AGING.map((b) => ({ key: b.key, label: b.label, amount: fromPaisa(aging[b.key]) })),
    },
  };
};

// ---- Customer statement ---------------------------------------------------------------------

/**
 * Everything between the company and one customer: their bookings with balances, and a dated
 * list of money received, refunded and moved by ownership transfer, with a running balance.
 */
const customerStatement = async (access, id) => {
  const scope = scopeWhere(access);
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null, OR: [scope, { bookings: { some: scope } }] },
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      fatherName: true,
      mobile: true,
      email: true,
      presentAddress: true,
    },
  });
  if (!customer) throw AppError.notFound("Customer not found");
  const today = dhakaDate();

  const [bookings, payments, refunds, transfers] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: id, confirmedAt: { not: null } },
      orderBy: { bookingDate: "asc" },
      select: {
        id: true,
        bookingNo: true,
        bookingDate: true,
        status: true,
        netPrice: true,
        totalPayable: true,
        planName: true,
        plot: { select: { code: true, areaSqft: true } },
        project: { select: { name: true } },
        installments: {
          orderBy: { number: "asc" },
          select: {
            number: true,
            dueDate: true,
            amount: true,
            lateFee: true,
            paidAmount: true,
            status: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: { customerId: id, status: { in: ["VERIFIED", "REVERSED"] } },
      select: {
        id: true,
        receiptNo: true,
        paidOn: true,
        amount: true,
        method: true,
        reference: true,
        status: true,
        reversedAt: true,
        reverseReason: true,
        booking: { select: { bookingNo: true, plot: { select: { code: true } } } },
      },
    }),
    prisma.cancellation.findMany({
      where: { booking: { customerId: id }, status: "REFUNDED", refundPaidOn: { not: null } },
      select: {
        id: true,
        cancellationNo: true,
        refundPaidOn: true,
        refundAmount: true,
        booking: { select: { bookingNo: true } },
      },
    }),
    prisma.ownershipTransfer.findMany({
      where: { status: "COMPLETED", OR: [{ fromCustomerId: id }, { toCustomerId: id }] },
      select: {
        id: true,
        transferNo: true,
        completedOn: true,
        amountPaid: true,
        feeAmount: true,
        fromCustomerId: true,
        fromCustomer: { select: { fullName: true } },
        toCustomer: { select: { fullName: true } },
        booking: { select: { bookingNo: true } },
      },
    }),
  ]);

  // Dated lines: "in" adds to what the company holds for the customer, "out" takes away
  const lines = [];
  for (const p of payments) {
    lines.push({
      date: p.paidOn,
      ref: p.receiptNo,
      kind: "RECEIPT",
      text: `${p.booking.bookingNo} (plot ${p.booking.plot.code}) · ${METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ""}`,
      in: p.amount.toString(),
      out: "0",
    });
    if (p.status === "REVERSED") {
      lines.push({
        date: dhakaDate(p.reversedAt ?? today),
        ref: p.receiptNo,
        kind: "REVERSAL",
        text: `Reversed${p.reverseReason ? `: ${p.reverseReason}` : ""}`,
        in: "0",
        out: p.amount.toString(),
      });
    }
  }
  for (const c of refunds) {
    lines.push({
      date: c.refundPaidOn,
      ref: c.cancellationNo,
      kind: "REFUND",
      text: `Refund on cancelling ${c.booking.bookingNo}`,
      in: "0",
      out: c.refundAmount.toString(),
    });
  }
  for (const t of transfers) {
    const outgoing = t.fromCustomerId === id;
    lines.push({
      date: t.completedOn,
      ref: t.transferNo,
      kind: outgoing ? "TRANSFER_OUT" : "TRANSFER_IN",
      text: outgoing
        ? `${t.booking.bookingNo} transferred to ${t.toCustomer.fullName}`
        : `${t.booking.bookingNo} received from ${t.fromCustomer.fullName}`,
      in: outgoing ? "0" : (t.amountPaid ?? 0).toString(),
      out: outgoing ? (t.amountPaid ?? 0).toString() : "0",
    });
  }
  lines.sort((a, b) => a.date - b.date || (a.kind === "RECEIPT" ? -1 : 1));
  let running = 0n;
  for (const line of lines) {
    running += toPaisa(line.in) - toPaisa(line.out);
    line.balance = fromPaisa(running);
  }

  return {
    customer,
    asOf: today,
    bookings: bookings.map(({ installments, ...b }) => ({
      ...b,
      balance: LIVE.includes(b.status) ? balanceOf(installments, today) : null,
      installments: LIVE.includes(b.status) ? installments : [],
    })),
    lines,
    totals: {
      received: fromPaisa(lines.reduce((t, l) => t + toPaisa(l.in), 0n)),
      paidOut: fromPaisa(lines.reduce((t, l) => t + toPaisa(l.out), 0n)),
      held: fromPaisa(running),
    },
  };
};

export const ReportService = { overview, sales, collections, outstanding, customerStatement };

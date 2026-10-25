import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { takaInWords } from "#core/money/words.js";
import { nextCode } from "#core/numbering/sequence.js";
import { buildScopeWhere, isInScope } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { dhakaDate } from "#core/utils/time.js";
import { notifyEmployee } from "#modules/lead/lead.workflow.js";
import {
  depositAccountFor,
  postPaymentReversed,
  postPaymentVerified,
} from "#modules/journal/journal.posting.js";
import {
  allocate,
  lockBooking,
  outstandingOf,
  unallocate,
} from "#modules/booking/booking.ledger.js";
import {
  METHOD_LABELS,
  PAYMENT_SEQUENCE,
  paymentDetailSelect,
  paymentListSelect,
  RECEIPT_SEQUENCE,
  userName,
} from "./collection.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;
const nameOf = (user) => user?.employee?.fullName ?? user?.username ?? null;

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const findPayment = async (access, id) => {
  const payment = await prisma.payment.findFirst({
    where: { id, AND: [scopeWhere(access)] },
    select: { ...paymentListSelect, bookingId: true, createdById: true, ownerId: true },
  });
  if (!payment) throw AppError.notFound("Payment not found");
  return payment;
};

/** Booking stamps copied onto its payments (same data scope as the booking). */
const stampOf = (booking) => ({
  ownerId: booking.ownerId,
  teamId: booking.teamId,
  departmentId: booking.departmentId,
  branchId: booking.branchId,
});

// ---- Queries --------------------------------------------------------------------------------

const list = async (access, query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, [
    "paymentNo",
    "receiptNo",
    "reference",
  ]);
  const search = query.search
    ? {
        OR: [
          searchWhere,
          { customer: { fullName: { contains: query.search, mode: "insensitive" } } },
          { booking: { bookingNo: { contains: query.search, mode: "insensitive" } } },
        ],
      }
    : {};
  const where = {
    AND: [
      scopeWhere(access),
      search,
      query.status ? { status: query.status } : {},
      query.method ? { method: query.method } : {},
      query.bookingId ? { bookingId: query.bookingId } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.from || query.to
        ? { paidOn: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) } }
        : {},
    ],
  };
  const [data, total, sum] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      skip,
      take,
      orderBy: [orderBy, { createdAt: "desc" }],
      select: paymentListSelect,
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);
  return {
    data,
    meta: {
      ...paginationMeta(query, total),
      totalAmount: fromPaisa(toPaisa(sum._sum.amount ?? 0)),
    },
  };
};

const getById = async (access, id) => {
  const payment = await prisma.payment.findFirst({
    where: { id, AND: [scopeWhere(access)] },
    select: paymentDetailSelect,
  });
  if (!payment) throw AppError.notFound("Payment not found");
  const people = await prisma.user.findMany({
    where: { id: { in: [payment.createdById, payment.verifiedById].filter(Boolean) } },
    select: userName.select,
  });
  const person = (userId) => {
    const user = people.find((u) => u.id === userId);
    return user ? { id: user.id, name: nameOf(user) } : null;
  };
  const { createdById, verifiedById, ...rest } = payment;
  const journal = await prisma.journalEntry.findMany({
    where: { sourceType: "Payment", sourceId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, entryNo: true, kind: true, date: true },
  });
  return {
    ...rest,
    journal,
    amountInWords: takaInWords(payment.amount),
    enteredBy: person(createdById),
    verifiedBy: person(verifiedById),
  };
};

// ---- Commands -------------------------------------------------------------------------------

/** Records money received; it counts once accounts verify it. */
const create = async (access, input) => {
  const { actor } = access;
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      bookingNo: true,
      status: true,
      customerId: true,
      ownerId: true,
      teamId: true,
      departmentId: true,
      branchId: true,
    },
  });
  if (!booking || !isInScope(actor, access.scope, booking))
    throw invalid("bookingId", "Booking not found");
  if (!["CONFIRMED", "REGISTERED"].includes(booking.status)) {
    throw invalid("bookingId", "Payments are taken on confirmed bookings only");
  }

  const [owed, pending] = await Promise.all([
    outstandingOf(prisma, booking.id),
    prisma.payment.aggregate({
      where: { bookingId: booking.id, status: "PENDING" },
      _sum: { amount: true },
    }),
  ]);
  const room = owed - toPaisa(pending._sum.amount ?? 0);
  if (toPaisa(input.amount) > room) {
    throw invalid(
      "amount",
      room > 0n
        ? `At most ${taka(fromPaisa(room))} is still owed (counting entries waiting for verification)`
        : "Nothing is owed on this booking",
    );
  }

  const payment = await prisma.$transaction(async (tx) =>
    tx.payment.create({
      data: {
        ...input,
        paidOn: input.paidOn ?? dhakaDate(),
        paymentNo: await nextCode(tx, PAYMENT_SEQUENCE),
        customerId: booking.customerId,
        ...stampOf(booking),
        createdById: actor.userId,
      },
    }),
  );
  return getById({ ...access, scope: "ALL" }, payment.id);
};

/**
 * Accounts confirm the money arrived: issues the money receipt number and applies the amount to
 * the schedule, oldest first. The person who entered it can't verify it (unless Super Admin).
 */
const verify = async (access, id, { depositAccountId } = {}) => {
  const { actor } = access;
  const payment = await findPayment(access, id);
  if (payment.status !== "PENDING")
    throw AppError.conflict(`This payment is already ${payment.status.toLowerCase()}`);
  if (payment.createdById === actor.userId && !actor.isSuperAdmin) {
    throw AppError.forbidden("Someone else must verify a payment you entered");
  }

  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payment.bookingId);
    const receiptNo = await nextCode(tx, RECEIPT_SEQUENCE);
    const { count } = await tx.payment.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "VERIFIED", receiptNo, verifiedById: actor.userId, verifiedAt: new Date() },
    });
    if (!count) throw AppError.conflict("Someone else just handled this payment");
    const deposit = await depositAccountFor(tx, payment.method, depositAccountId);
    await tx.payment.update({ where: { id }, data: { depositAccountId: deposit.id } });
    await allocate(tx, payment);
    await postPaymentVerified(tx, id, actor);
    await recordAudit(
      {
        action: "PAYMENT_VERIFIED",
        entityType: "Booking",
        entityId: payment.bookingId,
        description: `Verified ${payment.paymentNo} (${receiptNo}): ${taka(payment.amount)} by ${METHOD_LABELS[payment.method]}`,
      },
      tx,
    );
    await notifyEmployee(tx, actor, payment.ownerId, {
      type: "PAYMENT_RECEIVED",
      title: `Payment received: ${taka(payment.amount)} from ${payment.customer.fullName}`,
      body: `${receiptNo} · ${payment.booking.bookingNo}`,
      link: `/collections/${id}`,
    });
  });
  return getById(access, id);
};

/** Refuses an entry that doesn't match the money received. It never counted. */
const reject = async (access, id, { reason }) => {
  const payment = await findPayment(access, id);
  if (payment.status !== "PENDING")
    throw AppError.conflict(`This payment is already ${payment.status.toLowerCase()}`);
  await prisma.payment.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      verifiedById: access.actor.userId,
      verifiedAt: new Date(),
    },
  });
  return getById(access, id);
};

/** Undoes a verified payment (bounced cheque, mistake): the installments owe that money again. */
const reverse = async (access, id, { reason }) => {
  const { actor } = access;
  const payment = await findPayment(access, id);
  if (payment.status !== "VERIFIED")
    throw AppError.conflict("Only a verified payment can be reversed");

  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payment.bookingId);
    const { count } = await tx.payment.updateMany({
      where: { id, status: "VERIFIED" },
      data: {
        status: "REVERSED",
        reversedById: actor.userId,
        reversedAt: new Date(),
        reverseReason: reason,
      },
    });
    if (!count) throw AppError.conflict("Someone else just handled this payment");
    await unallocate(tx, id);
    await postPaymentReversed(tx, id, actor);
    await recordAudit(
      {
        action: "PAYMENT_REVERSED",
        entityType: "Booking",
        entityId: payment.bookingId,
        description: `Reversed ${payment.paymentNo} (${payment.receiptNo}): ${taka(payment.amount)} — ${reason}`,
      },
      tx,
    );
    await notifyEmployee(tx, actor, payment.ownerId, {
      type: "PAYMENT_REVERSED",
      title: `Payment reversed: ${taka(payment.amount)} from ${payment.customer.fullName}`,
      body: `${payment.receiptNo} · ${reason}`,
      link: `/collections/${id}`,
    });
  });
  return getById(access, id);
};

export const CollectionService = { list, getById, create, verify, reject, reverse };

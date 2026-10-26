import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { cancelApproval, submitApproval } from "#core/approval/engine.js";
import { registerApprovalHandlers } from "#core/approval/handlers.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, roundToTaka, toPaisa } from "#core/money/money.js";
import { nextCode } from "#core/numbering/sequence.js";
import { buildScopeWhere, isInScope } from "#core/rbac/scope.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import { dhakaDate } from "#core/utils/time.js";
import {
  depositAccountFor,
  postCancellation,
  postRefundPaid,
} from "#modules/journal/journal.posting.js";
import { cancellationChargeFor } from "#modules/payment-plan/payment-plan.schedule.js";

const SEQUENCE = { key: "CANCELLATION", prefix: "CN-", padding: 6 };
const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;

const select = {
  id: true,
  cancellationNo: true,
  reason: true,
  requestedOn: true,
  totalPaid: true,
  chargeAmount: true,
  refundAmount: true,
  policy: true,
  status: true,
  approvalRequestId: true,
  approvedAt: true,
  closeReason: true,
  refundPaidOn: true,
  refundMethod: true,
  refundReference: true,
  refundedAt: true,
  createdAt: true,
  refundAccount: { select: { id: true, code: true, name: true } },
  booking: {
    select: {
      id: true,
      bookingNo: true,
      status: true,
      plot: { select: { id: true, code: true } },
      project: { select: { name: true } },
      customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
      owner: { select: { id: true, fullName: true } },
    },
  },
};

/** Installment money paid on a booking (verified payments, late-fee parts excluded), in paisa. */
async function paidOf(tx, bookingId) {
  const allocations = await tx.paymentAllocation.findMany({
    where: { payment: { bookingId, status: "VERIFIED" } },
    select: { amount: true, lateFeePart: true },
  });
  return allocations.reduce((sum, a) => sum + toPaisa(a.amount) - toPaisa(a.lateFeePart), 0n);
}

const policyText = (terms) =>
  Number(terms.cancellationChargeValue) > 0
    ? terms.cancellationChargeType === "PERCENT"
      ? `${Number(terms.cancellationChargeValue)}% of the amount paid`
      : `${taka(terms.cancellationChargeValue)} fixed`
    : "No cancellation charge";

/** A confirmed booking the actor may cancel, with what it would refund. */
async function calculate(access, bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      plot: { select: { code: true } },
      project: { select: { name: true } },
      customer: { select: { fullName: true, customerCode: true } },
    },
  });
  if (!booking || !isInScope(access.actor, access.scope, booking))
    throw invalid("bookingId", "Booking not found");
  if (booking.status !== "CONFIRMED") {
    throw invalid(
      "bookingId",
      booking.status === "REGISTERED"
        ? "A registered (sold) booking can't be cancelled"
        : "Only a confirmed booking can be cancelled",
    );
  }
  const pending = await prisma.payment.count({ where: { bookingId, status: "PENDING" } });
  if (pending)
    throw invalid(
      "bookingId",
      "Payments are waiting for verification. Verify or reject them first.",
    );
  const paid = await paidOf(prisma, bookingId);
  const charge = toPaisa(cancellationChargeFor(booking.planTerms, fromPaisa(paid)));
  return {
    booking,
    totalPaid: fromPaisa(paid),
    chargeAmount: fromPaisa(charge),
    refundAmount: fromPaisa(paid - charge),
    policy: {
      cancellationChargeType: booking.planTerms.cancellationChargeType,
      cancellationChargeValue: String(booking.planTerms.cancellationChargeValue),
      text: policyText(booking.planTerms),
    },
  };
}

const quote = async (access, { bookingId }) => {
  const { booking, ...rest } = await calculate(access, bookingId);
  return { bookingNo: booking.bookingNo, ...rest };
};

const create = async (access, { bookingId, reason }) => {
  const { actor } = access;
  const calc = await calculate(access, bookingId);
  const { booking } = calc;
  const open = await prisma.cancellation.findFirst({
    where: { bookingId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
  });
  if (open) throw AppError.conflict(`This booking already has ${open.cancellationNo}`);

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.cancellation.create({
      data: {
        cancellationNo: await nextCode(tx, SEQUENCE),
        bookingId,
        reason,
        requestedOn: dhakaDate(),
        totalPaid: calc.totalPaid,
        chargeAmount: calc.chargeAmount,
        refundAmount: calc.refundAmount,
        policy: calc.policy,
        ownerId: booking.ownerId,
        teamId: booking.teamId,
        departmentId: booking.departmentId,
        branchId: booking.branchId,
        createdById: actor.userId,
      },
    });
    const request = await submitApproval(tx, actor, {
      workflow: "CANCELLATION",
      entityType: "Cancellation",
      entityId: c.id,
      title: `Cancel ${booking.bookingNo} (plot ${booking.plot.code}) for ${booking.customer.fullName}`,
      summary: `${reason} — refund ${taka(calc.refundAmount)} of ${taka(calc.totalPaid)} paid`,
      link: `/bookings/${booking.id}`,
      amount: calc.refundAmount,
      snapshot: {
        Cancellation: c.cancellationNo,
        Booking: booking.bookingNo,
        Customer: `${booking.customer.fullName} (${booking.customer.customerCode})`,
        Plot: `${booking.plot.code} · ${booking.project.name}`,
        "Paid so far": taka(calc.totalPaid),
        "Cancellation charge": `${taka(calc.chargeAmount)} (${calc.policy.text})`,
        Refund: taka(calc.refundAmount),
        Reason: reason,
      },
    });
    await tx.cancellation.update({ where: { id: c.id }, data: { approvalRequestId: request.id } });
    await recordAudit(
      {
        action: "CANCELLATION_REQUESTED",
        entityType: "Booking",
        entityId: booking.id,
        description: `Requested ${c.cancellationNo}: refund ${taka(calc.refundAmount)} — ${reason}`,
      },
      tx,
    );
    return c;
  });
  return getById({ ...access, scope: "ALL" }, created.id);
};

// ---- Approval handlers ----------------------------------------------------------------------

async function pending(tx, request) {
  const c = await tx.cancellation.findUnique({ where: { id: request.entityId } });
  if (!c || c.status !== "PENDING_APPROVAL")
    throw AppError.conflict("This cancellation is no longer waiting for approval");
  return c;
}

/** Approved: cancel the booking, write off what is unpaid, free the plot and post it. */
async function approve(tx, request) {
  const c = await pending(tx, request);
  const paid = await paidOf(tx, c.bookingId);
  const refund = roundToTaka(toPaisa(request.approvedAmount ?? request.amount ?? c.refundAmount));
  if (refund > paid) {
    throw AppError.unprocessable("The refund can't be more than what was paid", [
      { path: "amount", message: `At most ${taka(fromPaisa(paid))}` },
    ]);
  }
  const booking = await tx.booking.findUnique({
    where: { id: c.bookingId },
    select: { id: true, bookingNo: true, plotId: true, status: true },
  });
  if (booking.status !== "CONFIRMED")
    throw AppError.conflict(`${booking.bookingNo} is no longer confirmed`);

  await tx.cancellation.update({
    where: { id: c.id },
    data: {
      totalPaid: fromPaisa(paid),
      refundAmount: fromPaisa(refund),
      chargeAmount: fromPaisa(paid - refund),
      status: refund > 0n ? "APPROVED" : "REFUNDED",
      approvedAt: new Date(),
    },
  });
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      closedAt: new Date(),
      closeReason: `${c.cancellationNo}: ${c.reason}`,
    },
  });
  await tx.installment.updateMany({
    where: { bookingId: booking.id, status: { in: ["DUE", "PARTIAL"] } },
    data: { status: "WAIVED" },
  });
  const { count } = await tx.plot.updateMany({
    where: { id: booking.plotId, status: "BOOKED" },
    data: { status: "AVAILABLE", statusChangedAt: new Date() },
  });
  if (count) {
    await tx.plotStatusHistory.create({
      data: {
        plotId: booking.plotId,
        fromStatus: "BOOKED",
        toStatus: "AVAILABLE",
        refType: "CANCELLATION",
        refId: booking.id,
        reason: `${booking.bookingNo} cancelled (${c.cancellationNo})`,
      },
    });
  }
  await postCancellation(tx, c.id, null);
}

const closeAs = (status) => async (tx, request) => {
  const c = await pending(tx, request);
  const last = await tx.approvalAction.findFirst({
    where: { requestId: request.id, decision: { in: ["REJECTED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    select: { comment: true },
  });
  await tx.cancellation.update({
    where: { id: c.id },
    data: { status, closeReason: last?.comment ?? null },
  });
};

registerApprovalHandlers("CANCELLATION", {
  onApproved: approve,
  onRejected: closeAs("REJECTED"),
  onCancelled: closeAs("WITHDRAWN"),
});

// ---- Queries and other commands -------------------------------------------------------------

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const list = async (access, query) => {
  const where = {
    AND: [
      scopeWhere(access),
      query.status ? { status: query.status } : {},
      query.search
        ? {
            OR: [
              { cancellationNo: { contains: query.search, mode: "insensitive" } },
              { booking: { bookingNo: { contains: query.search, mode: "insensitive" } } },
              {
                booking: {
                  customer: { fullName: { contains: query.search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {},
    ],
  };
  const [data, total] = await prisma.$transaction([
    prisma.cancellation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select,
    }),
    prisma.cancellation.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => {
  const c = await prisma.cancellation.findFirst({
    where: { id, AND: [scopeWhere(access)] },
    select,
  });
  if (!c) throw AppError.notFound("Cancellation not found");
  const journal = await prisma.journalEntry.findMany({
    where: { sourceId: id, sourceType: { in: ["Cancellation", "Refund"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, entryNo: true, sourceType: true },
  });
  return { ...c, journal };
};

/** Accounts pay the refund out; posts Dr Refunds payable / Cr the account paid from. */
const payRefund = async (access, id, { paidOn, method, reference, accountId }) => {
  const c = await getById(access, id);
  if (c.status !== "APPROVED")
    throw AppError.conflict("Only an approved cancellation has a refund to pay");
  await prisma.$transaction(async (tx) => {
    const account = await depositAccountFor(tx, method, accountId);
    const { count } = await tx.cancellation.updateMany({
      where: { id, status: "APPROVED" },
      data: {
        status: "REFUNDED",
        refundPaidOn: paidOn ?? dhakaDate(),
        refundMethod: method,
        refundReference: reference ?? null,
        refundAccountId: account.id,
        refundedById: access.actor.userId,
        refundedAt: new Date(),
      },
    });
    if (!count) throw AppError.conflict("Someone else just paid this refund");
    await postRefundPaid(tx, id, access.actor);
    await recordAudit(
      {
        action: "REFUND_PAID",
        entityType: "Booking",
        entityId: c.booking.id,
        description: `Paid the ${taka(c.refundAmount)} refund of ${c.cancellationNo} from ${account.code} ${account.name}`,
      },
      tx,
    );
  });
  return getById(access, id);
};

const withdraw = async (access, id, { reason }) => {
  const c = await getById(access, id);
  if (c.status !== "PENDING_APPROVAL")
    throw AppError.conflict("Only a cancellation waiting for approval can be withdrawn");
  await prisma.$transaction((tx) =>
    cancelApproval(tx, access.actor, c.approvalRequestId, { comment: reason }),
  );
  return getById(access, id);
};

export const CancellationService = { quote, create, list, getById, payRefund, withdraw };

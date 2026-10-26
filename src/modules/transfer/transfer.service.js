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
import { toFileDto } from "#modules/file/file.service.js";
import { fileSelect } from "#modules/file/file.constant.js";
import { lockBooking, paidOf } from "#modules/booking/booking.ledger.js";
import { depositAccountFor, postTransfer } from "#modules/journal/journal.posting.js";
import { transferFeeFor } from "#modules/payment-plan/payment-plan.schedule.js";

const SEQUENCE = { key: "TRANSFER", prefix: "TR-", padding: 6 };
const OPEN = ["PENDING_APPROVAL", "APPROVED"];
const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;

const customer = { select: { id: true, customerCode: true, fullName: true, mobile: true } };

const select = {
  id: true,
  transferNo: true,
  reason: true,
  requestedOn: true,
  feeAmount: true,
  feePolicy: true,
  amountPaid: true,
  status: true,
  approvalRequestId: true,
  approvedAt: true,
  closeReason: true,
  completedOn: true,
  feeMethod: true,
  feeReference: true,
  completedAt: true,
  createdAt: true,
  fromCustomer: customer,
  toCustomer: customer,
  feeAccount: { select: { id: true, code: true, name: true } },
  booking: {
    select: {
      id: true,
      bookingNo: true,
      status: true,
      netPrice: true,
      plot: { select: { id: true, code: true } },
      project: { select: { name: true } },
      customer,
      owner: { select: { id: true, fullName: true } },
    },
  },
};

const ENTITY = "OwnershipTransfer";

/** An uploaded file not yet attached elsewhere (or already this transfer's). */
async function agreementFile(db, fileId, transferId) {
  const file = await db.file.findFirst({ where: { id: fileId, deletedAt: null } });
  if (!file) throw invalid("agreementFileId", "Upload the transfer agreement");
  if (file.entityType && !(file.entityType === ENTITY && file.entityId === transferId)) {
    throw invalid("agreementFileId", "This file belongs to another record");
  }
  return file;
}

const attach = (db, fileId, transferId) =>
  db.file.update({
    where: { id: fileId },
    data: { entityType: ENTITY, entityId: transferId, category: "AGREEMENT" },
  });

/** The transfers' current agreements by transfer id. */
export async function agreementsFor(transferIds) {
  if (!transferIds.length) return new Map();
  const files = await prisma.file.findMany({
    where: {
      entityType: ENTITY,
      entityId: { in: transferIds },
      category: "AGREEMENT",
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: fileSelect,
  });
  const map = new Map();
  for (const f of files) if (!map.has(f.entityId)) map.set(f.entityId, toFileDto(f));
  return map;
}

const policyText = (terms) =>
  Number(terms.transferFeeValue ?? 0) > 0
    ? terms.transferFeeType === "PERCENT"
      ? `${Number(terms.transferFeeValue)}% of the net price`
      : `${taka(terms.transferFeeValue)} fixed`
    : "No transfer fee";

async function noPendingPayments(db, bookingId) {
  const pending = await db.payment.count({ where: { bookingId, status: "PENDING" } });
  if (pending)
    throw invalid(
      "bookingId",
      "Payments are waiting for verification. Verify or reject them first.",
    );
}

/** A confirmed booking the actor may transfer, with the fee its plan charges. */
async function calculate(access, bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      plot: { select: { code: true } },
      project: { select: { name: true } },
      customer: { select: { id: true, fullName: true, customerCode: true } },
    },
  });
  if (!booking || !isInScope(access.actor, access.scope, booking))
    throw invalid("bookingId", "Booking not found");
  if (booking.status !== "CONFIRMED") {
    throw invalid(
      "bookingId",
      booking.status === "REGISTERED"
        ? "A registered (sold) booking can't be transferred here; the deed is in the customer's name"
        : "Only a confirmed booking can be transferred",
    );
  }
  await noPendingPayments(prisma, bookingId);
  const paid = await paidOf(prisma, bookingId);
  return {
    booking,
    amountPaid: fromPaisa(paid),
    feeAmount: transferFeeFor(booking.planTerms, booking.netPrice),
    feePolicy: {
      transferFeeType: booking.planTerms.transferFeeType ?? "FIXED",
      transferFeeValue: String(booking.planTerms.transferFeeValue ?? 0),
      text: policyText(booking.planTerms),
    },
  };
}

const quote = async (access, { bookingId }) => {
  const { booking, ...rest } = await calculate(access, bookingId);
  return { bookingNo: booking.bookingNo, fromCustomer: booking.customer, ...rest };
};

const create = async (access, { bookingId, toCustomerId, reason, agreementFileId }) => {
  const { actor } = access;
  const calc = await calculate(access, bookingId);
  const { booking } = calc;
  if (toCustomerId === booking.customerId)
    throw invalid("toCustomerId", "The booking already belongs to this customer");
  const to = await prisma.customer.findFirst({
    where: { id: toCustomerId, deletedAt: null },
    select: { id: true, fullName: true, customerCode: true },
  });
  if (!to) throw invalid("toCustomerId", "Customer not found");
  const open = await prisma.ownershipTransfer.findFirst({
    where: { bookingId, status: { in: OPEN } },
  });
  if (open) throw AppError.conflict(`This booking already has ${open.transferNo}`);
  const cancelling = await prisma.cancellation.findFirst({
    where: { bookingId, status: "PENDING_APPROVAL" },
  });
  if (cancelling)
    throw AppError.conflict(`${cancelling.cancellationNo} is waiting for approval on this booking`);
  const agreement = await agreementFile(prisma, agreementFileId, null);

  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.ownershipTransfer.create({
      data: {
        transferNo: await nextCode(tx, SEQUENCE),
        bookingId,
        fromCustomerId: booking.customerId,
        toCustomerId,
        reason,
        requestedOn: dhakaDate(),
        feeAmount: calc.feeAmount,
        feePolicy: calc.feePolicy,
        amountPaid: calc.amountPaid,
        ownerId: booking.ownerId,
        teamId: booking.teamId,
        departmentId: booking.departmentId,
        branchId: booking.branchId,
        createdById: actor.userId,
      },
    });
    const request = await submitApproval(tx, actor, {
      workflow: "OWNERSHIP_TRANSFER",
      entityType: "OwnershipTransfer",
      entityId: t.id,
      title: `Transfer ${booking.bookingNo} (plot ${booking.plot.code}) from ${booking.customer.fullName} to ${to.fullName}`,
      summary: `${reason} — fee ${taka(calc.feeAmount)}, ${taka(calc.amountPaid)} paid so far moves with it`,
      link: `/bookings/${booking.id}`,
      amount: calc.feeAmount,
      snapshot: {
        Transfer: t.transferNo,
        Booking: booking.bookingNo,
        Plot: `${booking.plot.code} · ${booking.project.name}`,
        "From customer": `${booking.customer.fullName} (${booking.customer.customerCode})`,
        "To customer": `${to.fullName} (${to.customerCode})`,
        "Paid so far": taka(calc.amountPaid),
        "Transfer fee": `${taka(calc.feeAmount)} (${calc.feePolicy.text})`,
        Agreement: agreement.originalName,
        Reason: reason,
      },
    });
    await tx.ownershipTransfer.update({
      where: { id: t.id },
      data: { approvalRequestId: request.id },
    });
    await attach(tx, agreement.id, t.id);
    await recordAudit(
      {
        action: "TRANSFER_REQUESTED",
        entityType: "Booking",
        entityId: booking.id,
        description: `Requested ${t.transferNo}: to ${to.fullName} (${to.customerCode}), fee ${taka(calc.feeAmount)} — ${reason}`,
      },
      tx,
    );
    return t;
  });
  return getById({ ...access, scope: "ALL" }, created.id);
};

/**
 * Hands the booking to the new customer: the money paid moves with it in the books, and the fee
 * (if any) is recorded as received into `accountId`.
 */
async function finish(tx, t, { completedOn, method, reference, accountId, actor }) {
  await lockBooking(tx, t.bookingId);
  const booking = await tx.booking.findUnique({
    where: { id: t.bookingId },
    select: { id: true, bookingNo: true, status: true, customerId: true },
  });
  if (booking.status !== "CONFIRMED")
    throw AppError.conflict(`${booking.bookingNo} is no longer confirmed`);
  if (booking.customerId !== t.fromCustomerId)
    throw AppError.conflict(`${booking.bookingNo} changed hands in the meantime`);
  await noPendingPayments(tx, t.bookingId);
  const paid = await paidOf(tx, t.bookingId);
  const { count } = await tx.ownershipTransfer.updateMany({
    where: { id: t.id, status: { in: OPEN } },
    data: {
      status: "COMPLETED",
      amountPaid: fromPaisa(paid),
      completedOn: completedOn ?? dhakaDate(),
      feeMethod: method ?? null,
      feeReference: reference ?? null,
      feeAccountId: accountId ?? null,
      completedById: actor?.userId ?? null,
      completedAt: new Date(),
    },
  });
  if (!count) throw AppError.conflict("Someone else just completed this transfer");
  await tx.booking.update({
    where: { id: booking.id },
    data: { customerId: t.toCustomerId, updatedById: actor?.userId ?? null },
  });
  await postTransfer(tx, t.id, actor);
  const to = await tx.customer.findUnique({
    where: { id: t.toCustomerId },
    select: { fullName: true, customerCode: true },
  });
  await recordAudit(
    {
      action: "TRANSFER_COMPLETED",
      entityType: "Booking",
      entityId: booking.id,
      description: `${t.transferNo}: ${booking.bookingNo} now belongs to ${to.fullName} (${to.customerCode})`,
    },
    tx,
  );
}

// ---- Approval handlers ----------------------------------------------------------------------

async function pending(tx, request) {
  const t = await tx.ownershipTransfer.findUnique({ where: { id: request.entityId } });
  if (!t || t.status !== "PENDING_APPROVAL")
    throw AppError.conflict("This transfer is no longer waiting for approval");
  return t;
}

/** Approved: the fee is set; with no fee to collect the booking changes hands right away. */
async function approve(tx, request) {
  const t = await pending(tx, request);
  const fee = roundToTaka(toPaisa(request.approvedAmount ?? request.amount ?? t.feeAmount));
  const approved = await tx.ownershipTransfer.update({
    where: { id: t.id },
    data: { feeAmount: fromPaisa(fee), status: "APPROVED", approvedAt: new Date() },
  });
  if (fee === 0n) await finish(tx, approved, {});
}

const closeAs = (status) => async (tx, request) => {
  const t = await pending(tx, request);
  const last = await tx.approvalAction.findFirst({
    where: { requestId: request.id, decision: { in: ["REJECTED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    select: { comment: true },
  });
  await tx.ownershipTransfer.update({
    where: { id: t.id },
    data: { status, closeReason: last?.comment ?? null },
  });
};

registerApprovalHandlers("OWNERSHIP_TRANSFER", {
  onApproved: approve,
  onRejected: closeAs("REJECTED"),
  onCancelled: closeAs("WITHDRAWN"),
});

// ---- Queries and other commands -------------------------------------------------------------

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const list = async (access, query) => {
  const contains = { contains: query.search, mode: "insensitive" };
  const where = {
    AND: [
      scopeWhere(access),
      query.status ? { status: query.status } : {},
      query.search
        ? {
            OR: [
              { transferNo: contains },
              { booking: { bookingNo: contains } },
              { fromCustomer: { fullName: contains } },
              { toCustomer: { fullName: contains } },
            ],
          }
        : {},
    ],
  };
  const [data, total] = await prisma.$transaction([
    prisma.ownershipTransfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select,
    }),
    prisma.ownershipTransfer.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => {
  const t = await prisma.ownershipTransfer.findFirst({
    where: { id, AND: [scopeWhere(access)] },
    select,
  });
  if (!t) throw AppError.notFound("Ownership transfer not found");
  const journal = await prisma.journalEntry.findMany({
    where: { sourceId: id, sourceType: "Transfer" },
    select: { id: true, entryNo: true, sourceType: true },
  });
  const agreement = (await agreementsFor([id])).get(id) ?? null;
  return { ...t, agreement, journal };
};

/** A better copy of the agreement, while the transfer still waits for approval. */
const replaceAgreement = async (access, id, { fileId }) => {
  const t = await getById(access, id);
  if (t.status !== "PENDING_APPROVAL")
    throw AppError.conflict(
      "The agreement can be replaced only while the transfer waits for approval",
    );
  const file = await agreementFile(prisma, fileId, id);
  await prisma.$transaction(async (tx) => {
    if (t.agreement && t.agreement.id !== file.id)
      await tx.file.update({ where: { id: t.agreement.id }, data: { deletedAt: new Date() } });
    await attach(tx, file.id, id);
    await recordAudit(
      {
        action: "TRANSFER_AGREEMENT_REPLACED",
        entityType: "Booking",
        entityId: t.booking.id,
        description: `${t.transferNo}: agreement replaced with ${file.originalName}`,
      },
      tx,
    );
  });
  return getById(access, id);
};

/** Accounts record the fee received; the booking then belongs to the new customer. */
const complete = async (access, id, { paidOn, method, reference, accountId }) => {
  const t = await getById(access, id);
  if (t.status !== "APPROVED")
    throw AppError.conflict("Only an approved transfer is waiting for its fee");
  await prisma.$transaction(async (tx) => {
    const account = await depositAccountFor(tx, method, accountId);
    const row = await tx.ownershipTransfer.findUnique({ where: { id } });
    await finish(tx, row, {
      completedOn: paidOn,
      method,
      reference,
      accountId: account.id,
      actor: access.actor,
    });
  });
  return getById(access, id);
};

const withdraw = async (access, id, { reason }) => {
  const t = await getById(access, id);
  if (t.status !== "PENDING_APPROVAL")
    throw AppError.conflict("Only a transfer waiting for approval can be withdrawn");
  await prisma.$transaction((tx) =>
    cancelApproval(tx, access.actor, t.approvalRequestId, { comment: reason }),
  );
  return getById(access, id);
};

export const TransferService = {
  quote,
  create,
  list,
  getById,
  replaceAgreement,
  complete,
  withdraw,
};

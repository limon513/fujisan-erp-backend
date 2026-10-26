import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { cancelApproval, submitApproval } from "#core/approval/engine.js";
import { registerApprovalHandlers } from "#core/approval/handlers.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { fromPaisa, percentOf, roundToTaka, toPaisa } from "#core/money/money.js";
import { nextCode } from "#core/numbering/sequence.js";
import { buildScopeWhere, isInScope } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { dhakaDate, dhakaDay } from "#core/utils/time.js";
import { advanceStatus, logActivity } from "#modules/lead/lead.workflow.js";
import { buildSchedule } from "#modules/payment-plan/payment-plan.schedule.js";
import { postRegistration } from "#modules/journal/journal.posting.js";
import {
  BOOKING_SEQUENCE,
  bookingDetailSelect,
  bookingListSelect,
  PLAN_TERMS,
} from "./booking.constant.js";
import { balanceOf } from "./booking.ledger.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (value) => `৳${Number(value).toLocaleString("en-IN")}`;

/** Today's Dhaka date at UTC midnight (date-only convention). */
const today = () => new Date(dhakaDay().start.getTime() + 6 * 3_600_000);

const pickTerms = (plan) => Object.fromEntries(PLAN_TERMS.map((key) => [key, plan[key]]));

// ---- Inputs ---------------------------------------------------------------------------------

async function loadPlot(plotId) {
  const plot = await prisma.plot.findFirst({
    where: { id: plotId, deletedAt: null },
    select: {
      id: true,
      code: true,
      price: true,
      status: true,
      projectId: true,
      project: { select: { id: true, name: true } },
      holds: {
        where: { status: "ACTIVE" },
        select: { id: true, customerId: true, requestedById: true },
      },
    },
  });
  if (!plot) throw invalid("plotId", "Plot not found");
  return plot;
}

async function loadPlan(paymentPlanId, projectId) {
  const plan = await prisma.paymentPlan.findFirst({
    where: {
      id: paymentPlanId,
      deletedAt: null,
      isActive: true,
      OR: [{ projectId: null }, { projectId }],
    },
  });
  if (!plan) throw invalid("paymentPlanId", "This plan isn't offered for the plot's project");
  return plan;
}

/** The customer must be one the actor can see. */
async function loadCustomer(actor, customerId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      id: true,
      customerCode: true,
      fullName: true,
      ownerId: true,
      teamId: true,
      departmentId: true,
      branchId: true,
    },
  });
  const scope = actor.isSuperAdmin ? "ALL" : actor.permissions["customer.view"];
  if (!customer || !scope || !isInScope(actor, scope, customer)) {
    throw invalid("customerId", "Customer not found");
  }
  return customer;
}

/** Discount in paisa (whole Taka), never more than the price. */
function discountOf(listPrice, { discountType, discountValue }) {
  const value =
    discountType === "PERCENT" ? percentOf(listPrice, discountValue) : toPaisa(discountValue);
  const discount = roundToTaka(value);
  if (discount > listPrice) throw invalid("discountValue", "The discount is more than the price");
  return discount;
}

/** Prices and schedule for a price under a plan's terms. */
function priceUp(terms, listPricePaisa, discountPaisa, bookingDate) {
  const net = listPricePaisa - discountPaisa;
  try {
    const schedule = buildSchedule(terms, { price: fromPaisa(net), startDate: bookingDate });
    return { net, schedule };
  } catch (error) {
    if (error instanceof RangeError) throw invalid("discountValue", error.message);
    throw error;
  }
}

const discountPercent = (discount, listPrice) =>
  listPrice > 0n ? (Number((discount * 10_000n) / listPrice) / 100).toFixed(2) : "0.00";

// ---- Plot reservation -----------------------------------------------------------------------

/** A plot on hold can only be booked for the customer it is held for, or by whoever asked. */
function assertBookable(plot, customerId, ownerId) {
  if (plot.status === "AVAILABLE") return;
  if (plot.status === "HOLD") {
    const hold = plot.holds[0];
    if (hold && (hold.customerId === customerId || (ownerId && hold.requestedById === ownerId)))
      return;
    throw AppError.conflict(`Plot ${plot.code} is on hold for someone else`);
  }
  throw AppError.conflict(`Plot ${plot.code} is ${plot.status.toLowerCase()}, not available`);
}

async function reservePlot(tx, plot, booking, actor) {
  const { count } = await tx.plot.updateMany({
    where: { id: plot.id, status: plot.status, deletedAt: null },
    data: { status: "BOOKED", statusChangedAt: new Date() },
  });
  if (!count) throw AppError.conflict(`Plot ${plot.code} was just taken by someone else`);
  await tx.plotStatusHistory.create({
    data: {
      plotId: plot.id,
      fromStatus: plot.status,
      toStatus: "BOOKED",
      refType: "BOOKING",
      refId: booking.id,
      reason: `${booking.bookingNo} submitted for approval`,
      changedById: actor.userId,
    },
  });
  if (plot.status === "HOLD") {
    await tx.plotHold.updateMany({
      where: { plotId: plot.id, status: "ACTIVE" },
      data: {
        status: "CONVERTED",
        releasedAt: new Date(),
        releasedById: actor.userId,
        releaseReason: `Booked as ${booking.bookingNo}`,
      },
    });
  }
}

/** Gives the plot back when a booking ends before registration. */
async function releasePlot(tx, booking, refType, reason) {
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
        refType,
        refId: booking.id,
        reason,
      },
    });
  }
}

// ---- Approval handlers (run inside the decision's transaction) ------------------------------

async function pendingBooking(tx, request) {
  const booking = await tx.booking.findUnique({ where: { id: request.entityId } });
  if (!booking || booking.status !== "PENDING_APPROVAL") {
    throw AppError.conflict("This booking is no longer waiting for approval");
  }
  return booking;
}

/** Confirms with the approved discount and creates the payment schedule. */
async function confirm(tx, request) {
  const booking = await pendingBooking(tx, request);
  const listPrice = toPaisa(booking.listPrice);
  const approved = request.approvedAmount ?? request.amount ?? booking.discountRequested;
  const discount = roundToTaka(toPaisa(approved));
  if (discount > listPrice) {
    throw AppError.unprocessable("The discount can't be more than the price", [
      { path: "amount", message: `At most ${taka(booking.listPrice)}` },
    ]);
  }
  const { net, schedule } = priceUp(booking.planTerms, listPrice, discount, booking.bookingDate);

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      discountAmount: fromPaisa(discount),
      netPrice: fromPaisa(net),
      interestAmount: schedule.interest,
      totalPayable: schedule.totalPayable,
      status: "CONFIRMED",
      confirmedAt: new Date(),
    },
  });
  await tx.installment.createMany({
    data: schedule.items.map((item) => ({
      bookingId: booking.id,
      number: item.number,
      kind: item.kind,
      dueDate: item.dueDate,
      amount: item.amount,
    })),
  });
  if (booking.leadId) {
    const lead = await tx.lead.findUnique({
      where: { id: booking.leadId },
      select: { status: true },
    });
    if (lead && lead.status !== "CONVERTED") {
      await tx.lead.update({
        where: { id: booking.leadId },
        data: {
          status: "CONVERTED",
          lostReason: null,
          convertedCustomerId: booking.customerId,
          convertedAt: new Date(),
        },
      });
      await logActivity(tx, booking.leadId, null, {
        type: "CONVERTED",
        fromStatus: lead.status,
        toStatus: "CONVERTED",
        body: `Booking ${booking.bookingNo} confirmed`,
      });
    }
  }
}

const close = (status, refType, verb) => async (tx, request) => {
  const booking = await pendingBooking(tx, request);
  const last = await tx.approvalAction.findFirst({
    where: { requestId: request.id, decision: { in: ["REJECTED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    select: { comment: true },
  });
  const reason = last?.comment ?? null;
  await tx.booking.update({
    where: { id: booking.id },
    data: { status, closedAt: new Date(), closeReason: reason },
  });
  await releasePlot(tx, booking, refType, `${booking.bookingNo} ${verb}`);
  if (booking.leadId) {
    await logActivity(tx, booking.leadId, null, {
      type: "NOTE",
      body: `Booking ${booking.bookingNo} ${verb}`,
    });
  }
};

registerApprovalHandlers("BOOKING", {
  onApproved: confirm,
  onRejected: close("REJECTED", "BOOKING_REJECTED", "rejected"),
  onCancelled: close("CANCELLED", "CANCELLATION", "withdrawn"),
});

// ---- Queries --------------------------------------------------------------------------------

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const list = async (access, query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, ["bookingNo"]);
  const search = query.search
    ? {
        OR: [
          searchWhere,
          { customer: { fullName: { contains: query.search, mode: "insensitive" } } },
          { plot: { code: { contains: query.search, mode: "insensitive" } } },
        ],
      }
    : {};
  const where = {
    AND: [
      scopeWhere(access),
      search,
      query.status ? { status: query.status } : {},
      query.projectId ? { projectId: query.projectId } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.plotId ? { plotId: query.plotId } : {},
    ],
  };
  const [data, total] = await prisma.$transaction([
    prisma.booking.findMany({ where, skip, take, orderBy, select: bookingListSelect }),
    prisma.booking.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => {
  const booking = await prisma.booking.findFirst({
    where: { id, AND: [scopeWhere(access)] },
    select: bookingDetailSelect,
  });
  if (!booking) throw AppError.notFound("Booking not found");
  const approval = booking.approvalRequestId
    ? await prisma.approvalRequest.findUnique({
        where: { id: booking.approvalRequestId },
        select: { id: true, requestNo: true, status: true, approvedAmount: true },
      })
    : null;
  const payments = await prisma.payment.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      paymentNo: true,
      receiptNo: true,
      amount: true,
      method: true,
      paidOn: true,
      status: true,
    },
  });
  const cancellations = await prisma.cancellation.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cancellationNo: true,
      status: true,
      reason: true,
      totalPaid: true,
      chargeAmount: true,
      refundAmount: true,
      approvalRequestId: true,
      refundPaidOn: true,
      closeReason: true,
    },
  });
  const transfers = await prisma.ownershipTransfer.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      transferNo: true,
      status: true,
      reason: true,
      feeAmount: true,
      amountPaid: true,
      approvalRequestId: true,
      completedOn: true,
      closeReason: true,
      fromCustomer: { select: { id: true, customerCode: true, fullName: true } },
      toCustomer: { select: { id: true, customerCode: true, fullName: true } },
    },
  });
  const journal = await prisma.journalEntry.findMany({
    where: { sourceType: "Booking", sourceId: id },
    select: { id: true, entryNo: true, kind: true, date: true },
  });
  const { ownerId: _o, teamId: _t, departmentId: _d, branchId: _b, ...rest } = booking;
  return {
    ...rest,
    approval,
    payments,
    cancellations,
    transfers,
    journal,
    balance: balanceOf(booking.installments, dhakaDate()),
  };
};

/** Live preview for the booking form: prices and the schedule (nothing is saved). */
const quote = async (access, input) => {
  const plot = await loadPlot(input.plotId);
  const plan = await loadPlan(input.paymentPlanId, plot.projectId);
  const listPrice = toPaisa(plot.price);
  const discount = discountOf(listPrice, input);
  const { net, schedule } = priceUp(plan, listPrice, discount, input.bookingDate ?? today());
  return {
    listPrice: fromPaisa(listPrice),
    discountAmount: fromPaisa(discount),
    discountPercent: discountPercent(discount, listPrice),
    netPrice: fromPaisa(net),
    planName: plan.name,
    schedule,
  };
};

// ---- Commands -------------------------------------------------------------------------------

/** Who sells it: the signed-in employee, else (e.g. an admin) the customer's salesperson. */
async function ownership(actor, customer) {
  if (actor.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: actor.employeeId },
      select: { id: true, teamId: true, departmentId: true, branchId: true },
    });
    return {
      ownerId: employee.id,
      teamId: employee.teamId,
      departmentId: employee.departmentId,
      branchId: employee.branchId,
    };
  }
  return {
    ownerId: customer.ownerId,
    teamId: customer.teamId,
    departmentId: customer.departmentId,
    branchId: customer.branchId,
  };
}

/**
 * Submits a booking: reserves the plot (BOOKED), moves the lead to BOOKING and asks for approval.
 * The approver settles the discount; confirmation creates the installments.
 */
const create = async (access, input) => {
  const { actor } = access;
  const [plot, customer] = await Promise.all([
    loadPlot(input.plotId),
    loadCustomer(actor, input.customerId),
  ]);
  const plan = await loadPlan(input.paymentPlanId, plot.projectId);
  const stamp = await ownership(actor, customer);
  assertBookable(plot, customer.id, stamp.ownerId);
  if (input.leadId) {
    const lead = await prisma.lead.count({ where: { id: input.leadId, deletedAt: null } });
    if (!lead) throw invalid("leadId", "Lead not found");
  }

  const bookingDate = input.bookingDate ?? today();
  const listPrice = toPaisa(plot.price);
  const discount = discountOf(listPrice, input);
  const { net, schedule } = priceUp(plan, listPrice, discount, bookingDate);
  const percent = discountPercent(discount, listPrice);

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        bookingNo: await nextCode(tx, BOOKING_SEQUENCE),
        plotId: plot.id,
        projectId: plot.projectId,
        customerId: customer.id,
        leadId: input.leadId ?? null,
        paymentPlanId: plan.id,
        bookingDate,
        listPrice: fromPaisa(listPrice),
        discountRequested: fromPaisa(discount),
        discountReason: input.discountReason ?? null,
        discountAmount: fromPaisa(discount),
        netPrice: fromPaisa(net),
        interestAmount: schedule.interest,
        totalPayable: schedule.totalPayable,
        planName: plan.name,
        planTerms: pickTerms(plan),
        notes: input.notes ?? null,
        ...stamp,
        createdById: actor.userId,
      },
    });
    await reservePlot(tx, plot, created, actor);
    if (created.leadId) {
      await advanceStatus(tx, created.leadId, "BOOKING", `Booking ${created.bookingNo} submitted`);
    }

    const request = await submitApproval(tx, actor, {
      workflow: "BOOKING",
      entityType: "Booking",
      entityId: created.id,
      title: `Booking of plot ${plot.code} for ${customer.fullName}`,
      summary: discount
        ? `Discount asked: ${taka(fromPaisa(discount))} (${percent}%) — ${input.discountReason}`
        : "No discount asked",
      link: `/bookings/${created.id}`,
      amount: fromPaisa(discount),
      percent,
      snapshot: {
        Booking: created.bookingNo,
        Customer: `${customer.fullName} (${customer.customerCode})`,
        Plot: `${plot.code} · ${plot.project.name}`,
        "List price": taka(fromPaisa(listPrice)),
        "Discount asked": discount ? `${taka(fromPaisa(discount))} (${percent}%)` : "None",
        "Price after discount": taka(fromPaisa(net)),
        "Payment plan": plan.name,
        "Down payment": taka(schedule.downPayment),
        Installments:
          schedule.items.length > 1
            ? `${schedule.items.length - 1} × ${taka(schedule.installmentAmount)}`
            : "None (full payment)",
      },
    });
    await tx.booking.update({ where: { id: created.id }, data: { approvalRequestId: request.id } });
    await recordAudit(
      {
        action: "BOOKING_SUBMITTED",
        entityType: "Booking",
        entityId: created.id,
        description: `Submitted booking ${created.bookingNo}: plot ${plot.code} for ${customer.fullName}, ${taka(fromPaisa(net))}`,
      },
      tx,
    );
    return created;
  });
  return getById({ actor, scope: "ALL" }, booking.id);
};

/** Withdraws a booking still waiting for approval; the plot becomes available again. */
const withdraw = async (access, id, { reason }) => {
  const booking = await getById(access, id);
  if (booking.status !== "PENDING_APPROVAL" || !booking.approvalRequestId) {
    throw AppError.conflict("Only a booking waiting for approval can be withdrawn");
  }
  await prisma.$transaction((tx) =>
    cancelApproval(tx, access.actor, booking.approvalRequestId, { comment: reason }),
  );
  return getById(access, id);
};

/** Deed registration: the booking is REGISTERED and the plot SOLD (client rule). */
const register = async (access, id, { registeredOn, deedNo, note }) => {
  const booking = await getById(access, id);
  if (booking.status !== "CONFIRMED") {
    throw AppError.conflict("Only a confirmed booking can be registered");
  }
  const open =
    (await prisma.ownershipTransfer.findFirst({
      where: { bookingId: id, status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
    })) ??
    (await prisma.cancellation.findFirst({ where: { bookingId: id, status: "PENDING_APPROVAL" } }));
  if (open)
    throw AppError.conflict(
      `${open.transferNo ?? open.cancellationNo} is open on this booking; finish or withdraw it first`,
    );
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id, status: "CONFIRMED" },
      data: {
        status: "REGISTERED",
        registeredOn: registeredOn ?? dhakaDate(),
        deedNo: deedNo ?? null,
        updatedById: access.actor.userId,
      },
    });
    if (!count) throw AppError.conflict("Someone else just changed this booking");
    const moved = await tx.plot.updateMany({
      where: { id: booking.plot.id, status: "BOOKED" },
      data: { status: "SOLD", statusChangedAt: new Date() },
    });
    if (moved.count) {
      await tx.plotStatusHistory.create({
        data: {
          plotId: booking.plot.id,
          fromStatus: "BOOKED",
          toStatus: "SOLD",
          refType: "REGISTRATION",
          refId: id,
          reason: [`${booking.bookingNo} registered`, deedNo && `deed ${deedNo}`, note]
            .filter(Boolean)
            .join(" · "),
          changedById: access.actor.userId,
        },
      });
    }
    await postRegistration(tx, id, access.actor);
    await recordAudit(
      {
        action: "BOOKING_REGISTERED",
        entityType: "Booking",
        entityId: id,
        description: `Registered ${booking.bookingNo}${deedNo ? ` (deed ${deedNo})` : ""}; plot ${booking.plot.code} sold. Outstanding ${taka(booking.balance.outstanding)}`,
      },
      tx,
    );
  });
  return getById(access, id);
};

export const BookingService = { list, getById, quote, create, withdraw, register };

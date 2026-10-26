import AppError from "#core/errors/AppError.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";

/**
 * A booking's schedule as a ledger: what each installment owes (amount + late fee − paid), how a
 * verified payment is applied (oldest first) and undone (exactly, on reversal).
 * All functions that write take a transaction client; amounts are exact (paisa).
 */

/** What an installment still owes; a waived one (e.g. after cancellation) owes nothing. */
const owedOf = (i) =>
  i.status === "WAIVED" ? 0n : toPaisa(i.amount) + toPaisa(i.lateFee) - toPaisa(i.paidAmount);

export const statusFor = (amount, lateFee, paid) =>
  paid <= 0n ? "DUE" : paid >= toPaisa(amount) + toPaisa(lateFee) ? "PAID" : "PARTIAL";

/** Locks the booking while its money changes, so two verifications never interleave. */
export async function lockBooking(tx, bookingId) {
  await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId}::uuid FOR UPDATE`;
}

/** Everything still owed on a booking (installments + late fees), in paisa. */
export async function outstandingOf(tx, bookingId) {
  const installments = await tx.installment.findMany({ where: { bookingId } });
  return installments.reduce((total, i) => total + owedOf(i), 0n);
}

/** Applies `amount` to the schedule oldest first; returns the allocations made. */
export async function allocate(tx, payment) {
  const installments = await tx.installment.findMany({
    where: { bookingId: payment.bookingId, status: { in: ["DUE", "PARTIAL"] } },
    orderBy: { number: "asc" },
  });
  let left = toPaisa(payment.amount);
  const allocations = [];
  for (const installment of installments) {
    if (left <= 0n) break;
    const owed = owedOf(installment);
    if (owed <= 0n) continue;
    const take = left < owed ? left : owed;
    const paid = toPaisa(installment.paidAmount) + take;
    const status = statusFor(installment.amount, installment.lateFee, paid);
    await tx.installment.update({
      where: { id: installment.id },
      data: { paidAmount: fromPaisa(paid), status, paidAt: status === "PAID" ? new Date() : null },
    });
    // The installment amount is paid first, its late fee last
    const before = toPaisa(installment.paidAmount);
    const amountLeft = toPaisa(installment.amount) - before;
    const towardsAmount = amountLeft > 0n ? (take < amountLeft ? take : amountLeft) : 0n;
    allocations.push({
      paymentId: payment.id,
      installmentId: installment.id,
      amount: fromPaisa(take),
      lateFeePart: fromPaisa(take - towardsAmount),
    });
    left -= take;
  }
  if (left > 0n) {
    throw AppError.unprocessable(`This is ${fromPaisa(left)} more than the booking still owes`, [
      { path: "amount", message: "More than what is owed" },
    ]);
  }
  await tx.paymentAllocation.createMany({ data: allocations });
  return allocations;
}

/** Takes a reversed payment's money back off exactly the installments it paid. */
export async function unallocate(tx, paymentId) {
  const allocations = await tx.paymentAllocation.findMany({
    where: { paymentId },
    include: { installment: true },
  });
  for (const { installment, amount } of allocations) {
    const paid = toPaisa(installment.paidAmount) - toPaisa(amount);
    const status =
      installment.status === "WAIVED"
        ? "WAIVED"
        : statusFor(installment.amount, installment.lateFee, paid);
    await tx.installment.update({
      where: { id: installment.id },
      data: {
        paidAmount: fromPaisa(paid),
        status,
        paidAt: status === "PAID" ? installment.paidAt : null,
      },
    });
  }
}

/**
 * Totals of a schedule for display: due (amount + late fees), paid, outstanding, and what is
 * overdue (past its due date, not yet paid).
 */
export function balanceOf(installments, today) {
  let due = 0n;
  let paid = 0n;
  let overdue = 0n;
  let overdueCount = 0;
  let lateFees = 0n;
  for (const i of installments) {
    // A waived installment is only due as far as it was paid
    due += i.status === "WAIVED" ? toPaisa(i.paidAmount) : toPaisa(i.amount) + toPaisa(i.lateFee);
    paid += toPaisa(i.paidAmount);
    lateFees += toPaisa(i.lateFee);
    const owed = owedOf(i);
    if (owed > 0n && i.dueDate < today) {
      overdue += owed;
      overdueCount += 1;
    }
  }
  return {
    due: fromPaisa(due),
    paid: fromPaisa(paid),
    outstanding: fromPaisa(due - paid),
    overdue: fromPaisa(overdue),
    overdueCount,
    lateFees: fromPaisa(lateFees),
  };
}

/** Installment money paid on a booking (verified payments, late-fee parts excluded), in paisa. */
export async function paidOf(tx, bookingId) {
  const allocations = await tx.paymentAllocation.findMany({
    where: { payment: { bookingId, status: "VERIFIED" } },
    select: { amount: true, lateFeePart: true },
  });
  return allocations.reduce((sum, a) => sum + toPaisa(a.amount) - toPaisa(a.lateFeePart), 0n);
}

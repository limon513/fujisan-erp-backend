import AppError from "#core/errors/AppError.js";
import { fromPaisa, toPaisa } from "#core/money/money.js";
import { nextCode } from "#core/numbering/sequence.js";
import { dhakaDate } from "#core/utils/time.js";

/**
 * Double-entry posting. Every entry balances (also checked by the database at commit) and is never
 * edited; mistakes are undone with a reversal. All functions take a transaction client.
 */

export const JOURNAL_SEQUENCE = { key: "JOURNAL", prefix: "JV-", padding: 6 };

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const taka = (paisa) => `৳${Number(fromPaisa(paisa)).toLocaleString("en-IN")}`;

/** Where money of each method lands by default. */
export const DEPOSIT_KEYS = {
  CASH: "CASH",
  BANK_TRANSFER: "BANK",
  CHEQUE: "BANK",
  CARD: "BANK",
  BKASH: "BKASH",
  NAGAD: "NAGAD",
};

/**
 * Accounts by system role, one after another: inside a transaction every query shares one
 * connection, so parallel queries would only queue on it (and trip a pg deprecation warning).
 */
async function accountsByKey(tx, keys) {
  const accounts = [];
  for (const key of keys) accounts.push(await accountByKey(tx, key));
  return accounts;
}

/** An account by its system role (seeded). */
export async function accountByKey(tx, key) {
  const account = await tx.account.findUnique({ where: { systemKey: key } });
  if (!account) throw new Error(`Account with system key ${key} is missing (run the seed)`);
  return account;
}

/** The fiscal year containing `date`, created on first use (July–June by default). */
export async function fiscalYearFor(tx, date) {
  const existing = await tx.fiscalYear.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
  });
  if (existing) {
    if (existing.status === "CLOSED") {
      throw invalid("date", `${existing.name} is closed; post in an open fiscal year`);
    }
    return existing;
  }
  const company = await tx.company.findFirst({ select: { fiscalYearStartMonth: true } });
  const startMonth = (company?.fiscalYearStartMonth ?? 7) - 1;
  const year = date.getUTCMonth() >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const startDate = new Date(Date.UTC(year, startMonth, 1));
  const endDate = new Date(Date.UTC(year + 1, startMonth, 0));
  const name = startMonth === 0 ? `FY ${year}` : `FY ${year}-${String(year + 1).slice(2)}`;
  // Parallel first postings of a year: one creates it, the other reads it back
  return tx.fiscalYear.upsert({
    where: { startDate },
    update: {},
    create: { name, startDate, endDate },
  });
}

/**
 * Posts a balanced entry.
 * @param entry { date, narration, kind, sourceType?, sourceId?, reversesId?, lines, actor? }
 *   lines: [{ accountId, debit?, credit?, description?, customerId?, bookingId? }] (amounts in BDT)
 */
export async function postEntry(
  tx,
  { date, narration, kind, sourceType, sourceId, reversesId, lines, actor },
) {
  const clean = lines
    .map((line) => ({
      ...line,
      debit: toPaisa(line.debit ?? 0),
      credit: toPaisa(line.credit ?? 0),
    }))
    .filter((line) => line.debit > 0n || line.credit > 0n);
  if (clean.length < 2) throw invalid("lines", "An entry needs at least two lines");
  clean.forEach((line, index) => {
    if (line.debit > 0n && line.credit > 0n) {
      throw invalid(`lines.${index}`, "A line is either a debit or a credit");
    }
    if (line.debit < 0n || line.credit < 0n)
      throw invalid(`lines.${index}`, "Amounts can't be negative");
  });
  const debit = clean.reduce((sum, l) => sum + l.debit, 0n);
  const credit = clean.reduce((sum, l) => sum + l.credit, 0n);
  if (debit !== credit) {
    throw invalid("lines", `Debits (${taka(debit)}) and credits (${taka(credit)}) must be equal`);
  }

  const accounts = await tx.account.findMany({
    where: { id: { in: [...new Set(clean.map((l) => l.accountId))] } },
    select: { id: true, code: true, isGroup: true, isActive: true },
  });
  clean.forEach((line, index) => {
    const account = accounts.find((a) => a.id === line.accountId);
    if (!account) throw invalid(`lines.${index}.accountId`, "Account not found");
    if (account.isGroup)
      throw invalid(
        `lines.${index}.accountId`,
        `${account.code} is a group; post to an account under it`,
      );
    if (!account.isActive)
      throw invalid(`lines.${index}.accountId`, `${account.code} is switched off`);
  });

  const fiscalYear = await fiscalYearFor(tx, date);
  return tx.journalEntry.create({
    data: {
      entryNo: await nextCode(tx, JOURNAL_SEQUENCE),
      date,
      fiscalYearId: fiscalYear.id,
      narration,
      kind,
      sourceType: sourceType ?? null,
      sourceId: sourceId == null ? null : String(sourceId),
      reversesId: reversesId ?? null,
      createdById: actor?.userId ?? null,
      lines: {
        create: clean.map((line, index) => ({
          accountId: line.accountId,
          debit: fromPaisa(line.debit),
          credit: fromPaisa(line.credit),
          description: line.description ?? null,
          customerId: line.customerId ?? null,
          bookingId: line.bookingId ?? null,
          lineNo: index + 1,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Posts the mirror of `original` (debits ↔ credits). An entry can be reversed only once. */
export async function reverseEntry(tx, original, { date, narration, sourceType, sourceId, actor }) {
  if (original.kind === "REVERSAL") throw AppError.conflict("A reversal can't be reversed");
  const already = await tx.journalEntry.findUnique({ where: { reversesId: original.id } });
  if (already)
    throw AppError.conflict(`${original.entryNo} was already reversed by ${already.entryNo}`);
  const lines =
    original.lines ?? (await tx.journalLine.findMany({ where: { entryId: original.id } }));
  return postEntry(tx, {
    date,
    narration,
    kind: "REVERSAL",
    sourceType,
    sourceId,
    reversesId: original.id,
    actor,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      description: line.description,
      customerId: line.customerId,
      bookingId: line.bookingId,
    })),
  });
}

// ---- Business postings ----------------------------------------------------------------------

/** Deposit account chosen at verification, else the default for the payment method. */
export async function depositAccountFor(tx, method, accountId) {
  if (!accountId) return accountByKey(tx, DEPOSIT_KEYS[method]);
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (!account || account.type !== "ASSET" || account.isGroup || !account.isActive) {
    throw invalid("depositAccountId", "Choose an active cash, bank or mobile account");
  }
  return account;
}

/**
 * Interest earned on a booking by now, in paisa: its interest in proportion to how much of the
 * installments (not the down payment) is paid. Flat interest is spread evenly over the
 * installments, so the share is exact, and computing the running total (rather than each
 * payment's slice) keeps rounding from drifting.
 */
async function interestEarned(tx, booking) {
  const interest = toPaisa(booking.interestAmount);
  if (interest === 0n) return 0n;
  const installments = await tx.installment.findMany({
    where: { bookingId: booking.id, number: { gt: 0 } },
    select: { amount: true },
  });
  const total = installments.reduce((sum, i) => sum + toPaisa(i.amount), 0n);
  const allocations = await tx.paymentAllocation.findMany({
    where: {
      payment: { bookingId: booking.id, status: "VERIFIED" },
      installment: { number: { gt: 0 } },
    },
    select: { amount: true, lateFeePart: true },
  });
  const paid = allocations.reduce((sum, a) => sum + toPaisa(a.amount) - toPaisa(a.lateFeePart), 0n);
  if (total === 0n) return 0n;
  return paid >= total ? interest : (interest * paid) / total;
}

/** Interest income already posted for a booking (credits − debits), in paisa. */
async function interestPosted(tx, bookingId, interestAccountId) {
  const sums = await tx.journalLine.aggregate({
    where: { bookingId, accountId: interestAccountId },
    _sum: { debit: true, credit: true },
  });
  return toPaisa(sums._sum.credit ?? 0) - toPaisa(sums._sum.debit ?? 0);
}

/**
 * Payment verified: Dr deposit account; Cr Customer advance (or Customer receivable once the booking
 * is registered) for the principal, Cr Installment interest income for the interest it earns, and
 * Cr Late fee income for the late-fee part.
 */
export async function postPaymentVerified(tx, paymentId, actor) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      allocations: true,
      booking: {
        select: {
          id: true,
          bookingNo: true,
          status: true,
          interestAmount: true,
          plot: { select: { code: true } },
        },
      },
      customer: { select: { id: true, fullName: true } },
    },
  });
  const deposit = await depositAccountFor(tx, payment.method, payment.depositAccountId);
  const lateFee = payment.allocations.reduce((sum, a) => sum + toPaisa(a.lateFeePart), 0n);
  const interestAccount = await accountByKey(tx, "INTEREST_INCOME");
  const earned = await interestEarned(tx, payment.booking);
  const posted = await interestPosted(tx, payment.bookingId, interestAccount.id);
  const due = earned - posted;
  const installment = toPaisa(payment.amount) - lateFee;
  const interest = due <= 0n ? 0n : due > installment ? installment : due;
  const customerSide = await accountByKey(
    tx,
    payment.booking.status === "REGISTERED" ? "CUSTOMER_RECEIVABLE" : "CUSTOMER_ADVANCE",
  );
  const party = { customerId: payment.customerId, bookingId: payment.bookingId };
  return postEntry(tx, {
    date: payment.paidOn,
    narration: `${payment.receiptNo}: ${payment.customer.fullName}, ${payment.booking.bookingNo} (plot ${payment.booking.plot.code})`,
    kind: "AUTO",
    sourceType: "Payment",
    sourceId: payment.id,
    actor,
    lines: [
      { accountId: deposit.id, debit: payment.amount, ...party },
      { accountId: customerSide.id, credit: fromPaisa(installment - interest), ...party },
      { accountId: interestAccount.id, credit: fromPaisa(interest), ...party },
      ...(lateFee > 0n
        ? [
            {
              accountId: (await accountByKey(tx, "LATE_FEE_INCOME")).id,
              credit: fromPaisa(lateFee),
              ...party,
            },
          ]
        : []),
    ],
  });
}

/** Payment reversed: the mirror of its verification entry (if it was posted). */
export async function postPaymentReversed(tx, paymentId, actor) {
  const original = await tx.journalEntry.findUnique({
    where: {
      sourceType_sourceId_kind: { sourceType: "Payment", sourceId: paymentId, kind: "AUTO" },
    },
    include: { lines: true },
  });
  if (!original) return null;
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  return reverseEntry(tx, original, {
    date: dhakaDate(),
    narration: `Reversal of ${payment.receiptNo}: ${payment.reverseReason ?? ""}`.trim(),
    sourceType: "Payment",
    sourceId: paymentId,
    actor,
  });
}

/** Customer-advance balance held for a booking (credits − debits), in paisa. */
async function advanceHeld(tx, bookingId, advanceAccountId) {
  const sums = await tx.journalLine.aggregate({
    where: { bookingId, accountId: advanceAccountId },
    _sum: { debit: true, credit: true },
  });
  return toPaisa(sums._sum.credit ?? 0) - toPaisa(sums._sum.debit ?? 0);
}

/**
 * Registration (the plot is sold): the sale is recognised at the net price. The advance held moves
 * out of liabilities; the rest of the price becomes a receivable. Interest is not part of it: it is
 * income as each installment is paid.
 *   Dr Customer advance (held) + Dr Customer receivable (price − held) = Cr Plot sales (net price)
 */
export async function postRegistration(tx, bookingId, actor) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { plot: { select: { code: true } }, customer: { select: { fullName: true } } },
  });
  const [advance, receivable, sales] = await accountsByKey(tx, [
    "CUSTOMER_ADVANCE",
    "CUSTOMER_RECEIVABLE",
    "SALES_REVENUE",
  ]);
  const held = await advanceHeld(tx, booking.id, advance.id);
  const total = toPaisa(booking.netPrice);
  const party = { customerId: booking.customerId, bookingId: booking.id };
  return postEntry(tx, {
    date: booking.registeredOn ?? dhakaDate(),
    narration: `Registration of ${booking.bookingNo}: plot ${booking.plot.code} sold to ${booking.customer.fullName}`,
    kind: "AUTO",
    sourceType: "Booking",
    sourceId: booking.id,
    actor,
    lines: [
      { accountId: advance.id, debit: fromPaisa(held), ...party },
      { accountId: receivable.id, debit: fromPaisa(total - held), ...party },
      { accountId: sales.id, credit: booking.netPrice, ...party },
    ],
  });
}

/**
 * Cancellation approved: the advance held is released and the interest earned on the booking is
 * taken back out of income; together they are what was paid, split into charge and refund.
 *   Dr Customer advance (held) + Dr Installment interest income (earned)
 *     = Cr Cancellation charge income (charge) + Cr Customer refunds payable (refund)
 */
export async function postCancellation(tx, cancellationId, actor) {
  const c = await tx.cancellation.findUnique({
    where: { id: cancellationId },
    include: {
      booking: {
        include: { plot: { select: { code: true } }, customer: { select: { fullName: true } } },
      },
    },
  });
  if (toPaisa(c.totalPaid) === 0n) return null;
  const [advance, income, payable, interest] = await accountsByKey(tx, [
    "CUSTOMER_ADVANCE",
    "CANCELLATION_INCOME",
    "REFUND_PAYABLE",
    "INTEREST_INCOME",
  ]);
  const earned = await interestPosted(tx, c.bookingId, interest.id);
  const held = toPaisa(c.totalPaid) - earned;
  const party = { customerId: c.booking.customerId, bookingId: c.bookingId };
  return postEntry(tx, {
    date: dhakaDate(),
    narration: `${c.cancellationNo}: ${c.booking.bookingNo} (plot ${c.booking.plot.code}) cancelled, ${c.booking.customer.fullName}`,
    kind: "AUTO",
    sourceType: "Cancellation",
    sourceId: c.id,
    actor,
    lines: [
      { accountId: advance.id, debit: fromPaisa(held), ...party },
      { accountId: interest.id, debit: fromPaisa(earned), ...party },
      { accountId: income.id, credit: c.chargeAmount, ...party },
      { accountId: payable.id, credit: c.refundAmount, ...party },
    ],
  });
}

/** A refund part paid out: Dr Customer refunds payable / Cr the cash or bank account paid from. */
export async function postRefundPaid(tx, partId, actor) {
  const part = await tx.refundInstallment.findUnique({
    where: { id: partId },
    include: {
      cancellation: {
        include: { booking: { include: { customer: { select: { fullName: true } } } } },
      },
    },
  });
  const c = part.cancellation;
  const payable = await accountByKey(tx, "REFUND_PAYABLE");
  const party = { customerId: c.booking.customerId, bookingId: c.bookingId };
  return postEntry(tx, {
    date: part.paidOn,
    narration: `Refund for ${c.cancellationNo} (part ${part.number}) to ${c.booking.customer.fullName}${part.reference ? ` (${part.reference})` : ""}`,
    kind: "AUTO",
    sourceType: "RefundPayment",
    sourceId: part.id,
    actor,
    lines: [
      { accountId: payable.id, debit: part.amount, ...party },
      { accountId: part.accountId, credit: part.amount, ...party },
    ],
  });
}

/**
 * Ownership transfer completed: the advance held for the booking moves to the new customer, and
 * the transfer fee (if any) is received.
 *   Dr Customer advance (old customer) / Cr Customer advance (new customer)
 *   Dr cash or bank account (fee) / Cr Ownership transfer fee income
 */
export async function postTransfer(tx, transferId, actor) {
  const t = await tx.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      booking: { select: { bookingNo: true, plot: { select: { code: true } } } },
      fromCustomer: { select: { fullName: true } },
      toCustomer: { select: { fullName: true } },
    },
  });
  const [advance, income] = await accountsByKey(tx, ["CUSTOMER_ADVANCE", "TRANSFER_FEE_INCOME"]);
  const held = await advanceHeld(tx, t.bookingId, advance.id);
  const fee = toPaisa(t.feeAmount);
  if (held <= 0n && fee === 0n) return null;
  const from = { customerId: t.fromCustomerId, bookingId: t.bookingId };
  const to = { customerId: t.toCustomerId, bookingId: t.bookingId };
  return postEntry(tx, {
    date: t.completedOn ?? dhakaDate(),
    narration: `${t.transferNo}: ${t.booking.bookingNo} (plot ${t.booking.plot.code}) from ${t.fromCustomer.fullName} to ${t.toCustomer.fullName}${t.feeReference ? ` (${t.feeReference})` : ""}`,
    kind: "AUTO",
    sourceType: "Transfer",
    sourceId: t.id,
    actor,
    lines: [
      ...(held > 0n
        ? [
            { accountId: advance.id, debit: fromPaisa(held), ...from },
            { accountId: advance.id, credit: fromPaisa(held), ...to },
          ]
        : []),
      ...(fee > 0n
        ? [
            { accountId: t.feeAccountId, debit: t.feeAmount, ...to },
            { accountId: income.id, credit: t.feeAmount, ...to },
          ]
        : []),
    ],
  });
}

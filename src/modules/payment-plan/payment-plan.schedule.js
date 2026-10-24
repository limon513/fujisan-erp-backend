import { fromPaisa, percentOf, roundToTaka, toPaisa } from "#core/money/money.js";

/** Months between two installments. */
export const FREQUENCY_MONTHS = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** `date` (UTC midnight) plus `months`, keeping the day but never past the month's end. */
export function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

const charge = (type, value, base) =>
  type === "PERCENT" ? percentOf(base, value) : toPaisa(value);

/**
 * Payment schedule for a price under a plan (pure; used for the preview and, at booking, for the
 * real EMI schedule).
 *
 * - Down payment: due on the start (booking) date.
 * - Interest: flat yearly rate on what is left after the down payment, for the plan's length.
 * - Installments: equal, whole Taka; the rounding remainder goes to the last one. The first is
 *   due one period after the start date.
 *
 * @param plan   { downPaymentType, downPaymentValue, installmentCount, frequency, interestRate }
 * @param input  { price (amount), startDate (Date at UTC midnight) }
 * @returns { price, downPayment, financed, interest, totalPayable, installmentAmount,
 *            items: [{ number, kind: "DOWN_PAYMENT" | "INSTALLMENT", dueDate, amount }] }
 *          amounts as "123.00" strings
 */
export function buildSchedule(plan, { price, startDate }) {
  const pricePaisa = toPaisa(price);
  if (pricePaisa <= 0n) throw new RangeError("The price must be more than zero");

  const down = roundToTaka(charge(plan.downPaymentType, plan.downPaymentValue, pricePaisa));
  if (down > pricePaisa) throw new RangeError("The down payment is more than the price");
  const financed = pricePaisa - down;
  const count = plan.installmentCount;
  if (financed > 0n && count < 1) throw new RangeError("The plan has no installments for the rest");

  const months = FREQUENCY_MONTHS[plan.frequency] * count;
  // financed × rate% × (months / 12)
  const interest =
    count > 0 ? roundToTaka(percentOf(financed * BigInt(months), plan.interestRate) / 12n) : 0n;
  const toInstall = financed + interest;
  const each = count > 0 ? (toInstall / BigInt(count) / 100n) * 100n : 0n;

  const items = [{ number: 0, kind: "DOWN_PAYMENT", dueDate: startDate, amount: fromPaisa(down) }];
  for (let n = 1; n <= count; n += 1) {
    const amount = n === count ? toInstall - each * BigInt(count - 1) : each;
    items.push({
      number: n,
      kind: "INSTALLMENT",
      dueDate: addMonths(startDate, FREQUENCY_MONTHS[plan.frequency] * n),
      amount: fromPaisa(amount),
    });
  }

  return {
    price: fromPaisa(pricePaisa),
    downPayment: fromPaisa(down),
    financed: fromPaisa(financed),
    interest: fromPaisa(interest),
    totalPayable: fromPaisa(pricePaisa + interest),
    installmentAmount: fromPaisa(each),
    items,
  };
}

/** Late fee for one overdue installment (once, after the grace period). */
export const lateFeeFor = (plan, installmentAmount) =>
  fromPaisa(roundToTaka(charge(plan.lateFeeType, plan.lateFeeValue, toPaisa(installmentAmount))));

/** Cancellation charge on the amount paid so far (never more than what was paid). */
export function cancellationChargeFor(plan, amountPaid) {
  const paid = toPaisa(amountPaid);
  const fee = roundToTaka(charge(plan.cancellationChargeType, plan.cancellationChargeValue, paid));
  return fromPaisa(fee > paid ? paid : fee);
}

import { describe, expect, it } from "vitest";
import { divRound, fromPaisa, percentOf, toPaisa } from "#core/money/money.js";
import {
  addMonths,
  buildSchedule,
  cancellationChargeFor,
  lateFeeFor,
} from "#modules/payment-plan/payment-plan.schedule.js";

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date) => date.toISOString().slice(0, 10);

const plan = (extra = {}) => ({
  downPaymentType: "PERCENT",
  downPaymentValue: "20",
  installmentCount: 24,
  frequency: "MONTHLY",
  interestRate: "0",
  ...extra,
});

describe("money", () => {
  it("is exact in paisa", () => {
    expect(toPaisa("4,850,000.5")).toBe(485000050n);
    expect(fromPaisa(toPaisa("0.1") + toPaisa("0.2"))).toBe("0.30");
    expect(fromPaisa(-150n)).toBe("-1.50");
    expect(fromPaisa(percentOf(toPaisa("4752000"), "12.5"))).toBe("594000.00");
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(() => toPaisa("12.345")).toThrow();
  });
});

describe("payment schedule", () => {
  it("keeps the day of the month, never past its end", () => {
    expect(iso(addMonths(day("2026-01-31"), 1))).toBe("2026-02-28");
    expect(iso(addMonths(day("2026-01-31"), 2))).toBe("2026-03-31");
    expect(iso(addMonths(day("2027-11-30"), 3))).toBe("2028-02-29");
  });

  it("splits the rest into equal whole-Taka installments, remainder last", () => {
    const s = buildSchedule(plan(), { price: "4752000", startDate: day("2026-10-25") });
    expect(s).toMatchObject({
      downPayment: "950400.00",
      financed: "3801600.00",
      interest: "0.00",
      totalPayable: "4752000.00",
      installmentAmount: "158400.00",
    });
    expect(s.items).toHaveLength(25);
    expect(s.items[1]).toMatchObject({ number: 1, amount: "158400.00" });
    expect(iso(s.items[1].dueDate)).toBe("2026-11-25");
    expect(iso(s.items[24].dueDate)).toBe("2028-10-25");

    const odd = buildSchedule(plan({ installmentCount: 7 }), {
      price: "1000000",
      startDate: day("2026-10-25"),
    });
    const amounts = odd.items.slice(1).map((i) => i.amount);
    expect(amounts.slice(0, 6).every((a) => a === "114285.00")).toBe(true);
    expect(amounts[6]).toBe("114290.00");
    const sum = odd.items.reduce((total, i) => total + toPaisa(i.amount), 0n);
    expect(fromPaisa(sum)).toBe(odd.totalPayable);
  });

  it("adds flat yearly interest on the financed amount", () => {
    // ৳40 Lac financed at 10% for 2 years = ৳8 Lac
    const s = buildSchedule(
      plan({
        downPaymentType: "FIXED",
        downPaymentValue: "1000000",
        interestRate: "10",
        installmentCount: 8,
        frequency: "QUARTERLY",
      }),
      { price: "5000000", startDate: day("2026-10-25") },
    );
    expect(s).toMatchObject({
      financed: "4000000.00",
      interest: "800000.00",
      totalPayable: "5800000.00",
    });
    expect(s.items[1].amount).toBe("600000.00");
    expect(iso(s.items[1].dueDate)).toBe("2027-01-25");
    expect(iso(s.items[8].dueDate)).toBe("2028-10-25");
  });

  it("supports full payment and refuses impossible plans", () => {
    const full = buildSchedule(plan({ downPaymentValue: "100", installmentCount: 0 }), {
      price: "4752000",
      startDate: day("2026-10-25"),
    });
    expect(full.items).toHaveLength(1);
    expect(full.downPayment).toBe("4752000.00");
    expect(() =>
      buildSchedule(plan({ installmentCount: 0 }), { price: "100", startDate: day("2026-10-25") }),
    ).toThrow(/no installments/);
    expect(() =>
      buildSchedule(plan({ downPaymentType: "FIXED", downPaymentValue: "500" }), {
        price: "100",
        startDate: day("2026-10-25"),
      }),
    ).toThrow(/more than the price/);
  });

  it("works out late fees and cancellation charges", () => {
    expect(lateFeeFor({ lateFeeType: "FIXED", lateFeeValue: "500" }, "158400")).toBe("500.00");
    expect(lateFeeFor({ lateFeeType: "PERCENT", lateFeeValue: "2" }, "158400")).toBe("3168.00");
    const pct = { cancellationChargeType: "PERCENT", cancellationChargeValue: "10" };
    expect(cancellationChargeFor(pct, "950400")).toBe("95040.00");
    const fixed = { cancellationChargeType: "FIXED", cancellationChargeValue: "200000" };
    expect(cancellationChargeFor(fixed, "150000")).toBe("150000.00");
  });
});

describe("amount in words", async () => {
  const { takaInWords, numberInWords } = await import("#core/money/words.js");
  it("uses crore, lakh and thousand", () => {
    expect(takaInWords("935400")).toBe("Taka Nine Lakh Thirty Five Thousand Four Hundred Only");
    expect(takaInWords("4677000.50")).toBe(
      "Taka Forty Six Lakh Seventy Seven Thousand and Fifty Paisa Only",
    );
    expect(numberInWords(1234567890n)).toBe(
      "One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety",
    );
    expect(takaInWords("0")).toBe("Taka Zero Only");
    expect(takaInWords("100000")).toBe("Taka One Lakh Only");
  });
});

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_values_valid" CHECK (
  "downPaymentValue" >= 0 AND ("downPaymentType" <> 'PERCENT' OR "downPaymentValue" <= 100)
  AND "installmentCount" BETWEEN 0 AND 360
  AND "interestRate" BETWEEN 0 AND 100
  AND "gracePeriodDays" BETWEEN 0 AND 365
  AND "lateFeeValue" >= 0 AND ("lateFeeType" <> 'PERCENT' OR "lateFeeValue" <= 100)
  AND "cancellationChargeValue" >= 0
  AND ("cancellationChargeType" <> 'PERCENT' OR "cancellationChargeValue" <= 100)
);
-- No installments only when the whole price is paid at booking
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_full_payment_or_installments" CHECK (
  "installmentCount" > 0 OR ("downPaymentType" = 'PERCENT' AND "downPaymentValue" = 100)
);

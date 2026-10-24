ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
-- A verified payment has its receipt; a reversed one was verified first
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_status_fields" CHECK (
  ("status" <> 'VERIFIED' OR ("receiptNo" IS NOT NULL AND "verifiedAt" IS NOT NULL))
  AND ("status" <> 'REVERSED' OR ("receiptNo" IS NOT NULL AND "reversedAt" IS NOT NULL))
);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_positive" CHECK ("amount" > 0);
-- An installment is never paid beyond its amount plus late fee
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_not_overpaid" CHECK (
  "paidAmount" <= "amount" + "lateFee"
);

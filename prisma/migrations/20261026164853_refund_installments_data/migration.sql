-- Refunds paid in one go before refund schedules existed become a single paid part
INSERT INTO "RefundInstallment" (
  "id", "cancellationId", "number", "dueDate", "amount", "status", "paidOn", "method",
  "reference", "accountId", "paidById", "paidAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), c."id", 1, c."refundPaidOn", c."refundAmount", 'PAID', c."refundPaidOn",
  c."refundMethod", c."refundReference", c."refundAccountId", c."refundedById", c."refundedAt",
  COALESCE(c."refundedAt", now()), now()
FROM "Cancellation" c
WHERE c."refundPaidOn" IS NOT NULL AND c."refundAmount" > 0;

ALTER TABLE "RefundInstallment" ADD CONSTRAINT "RefundInstallment_amount_positive" CHECK ("amount" > 0);

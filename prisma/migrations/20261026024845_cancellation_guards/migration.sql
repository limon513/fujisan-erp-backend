-- One open cancellation per booking
CREATE UNIQUE INDEX "Cancellation_one_pending_per_booking" ON "Cancellation" ("bookingId")
  WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED');

ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_amounts_valid" CHECK (
  "totalPaid" >= 0 AND "chargeAmount" >= 0 AND "refundAmount" >= 0
  AND "chargeAmount" + "refundAmount" = "totalPaid"
);

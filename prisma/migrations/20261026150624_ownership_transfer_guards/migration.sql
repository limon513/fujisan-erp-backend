-- One open transfer per booking
CREATE UNIQUE INDEX "OwnershipTransfer_one_open_per_booking" ON "OwnershipTransfer" ("bookingId")
  WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED');

ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_valid" CHECK (
  "fromCustomerId" <> "toCustomerId" AND "feeAmount" >= 0
);

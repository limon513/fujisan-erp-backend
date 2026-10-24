-- A plot has at most one live booking (pending, confirmed or registered)
CREATE UNIQUE INDEX "Booking_one_live_per_plot" ON "Booking" ("plotId")
  WHERE "status" IN ('PENDING_APPROVAL', 'CONFIRMED', 'REGISTERED');

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amounts_valid" CHECK (
  "listPrice" > 0
  AND "discountRequested" >= 0 AND "discountRequested" <= "listPrice"
  AND "discountAmount" >= 0 AND "discountAmount" <= "listPrice"
  AND "netPrice" = "listPrice" - "discountAmount"
  AND "interestAmount" >= 0
  AND "totalPayable" = "netPrice" + "interestAmount"
);

ALTER TABLE "Installment" ADD CONSTRAINT "Installment_amounts_valid" CHECK (
  "amount" >= 0 AND "paidAmount" >= 0 AND "lateFee" >= 0 AND "number" >= 0
);

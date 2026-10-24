-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'BKASH', 'NAGAD', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "deedNo" TEXT,
ADD COLUMN     "registeredOn" DATE;

-- AlterTable
ALTER TABLE "Installment" ADD COLUMN     "lateFeeAppliedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lateFeeWaivedReason" TEXT,
ADD COLUMN     "reminderDays" INTEGER;

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "receiptNo" TEXT,
    "bookingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "bankName" TEXT,
    "chequeDate" DATE,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(3),
    "reverseReason" TEXT,
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE INDEX "Payment_bookingId_status_idx" ON "Payment"("bookingId", "status");

-- CreateIndex
CREATE INDEX "Payment_status_paidOn_idx" ON "Payment"("status", "paidOn");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_installmentId_idx" ON "PaymentAllocation"("installmentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


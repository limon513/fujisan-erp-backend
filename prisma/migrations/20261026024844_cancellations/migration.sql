-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REFUNDED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" UUID NOT NULL,
    "cancellationNo" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedOn" DATE NOT NULL,
    "totalPaid" DECIMAL(14,2) NOT NULL,
    "chargeAmount" DECIMAL(14,2) NOT NULL,
    "refundAmount" DECIMAL(14,2) NOT NULL,
    "policy" JSONB NOT NULL,
    "status" "CancellationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalRequestId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "closeReason" TEXT,
    "refundPaidOn" DATE,
    "refundMethod" "PaymentMethod",
    "refundReference" TEXT,
    "refundAccountId" UUID,
    "refundedById" UUID,
    "refundedAt" TIMESTAMPTZ(3),
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cancellation_cancellationNo_key" ON "Cancellation"("cancellationNo");

-- CreateIndex
CREATE INDEX "Cancellation_bookingId_status_idx" ON "Cancellation"("bookingId", "status");

-- CreateIndex
CREATE INDEX "Cancellation_status_createdAt_idx" ON "Cancellation"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_refundAccountId_fkey" FOREIGN KEY ("refundAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


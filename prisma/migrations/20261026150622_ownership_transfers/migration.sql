-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "PaymentPlan" ADD COLUMN     "transferFeeType" "ChargeType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "transferFeeValue" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OwnershipTransfer" (
    "id" UUID NOT NULL,
    "transferNo" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "fromCustomerId" UUID NOT NULL,
    "toCustomerId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedOn" DATE NOT NULL,
    "feeAmount" DECIMAL(14,2) NOT NULL,
    "feePolicy" JSONB NOT NULL,
    "amountPaid" DECIMAL(14,2),
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalRequestId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "closeReason" TEXT,
    "completedOn" DATE,
    "feeMethod" "PaymentMethod",
    "feeReference" TEXT,
    "feeAccountId" UUID,
    "completedById" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "OwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipTransfer_transferNo_key" ON "OwnershipTransfer"("transferNo");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_bookingId_status_idx" ON "OwnershipTransfer"("bookingId", "status");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_status_createdAt_idx" ON "OwnershipTransfer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_fromCustomerId_idx" ON "OwnershipTransfer"("fromCustomerId");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_toCustomerId_idx" ON "OwnershipTransfer"("toCustomerId");

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_fromCustomerId_fkey" FOREIGN KEY ("fromCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_toCustomerId_fkey" FOREIGN KEY ("toCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_feeAccountId_fkey" FOREIGN KEY ("feeAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


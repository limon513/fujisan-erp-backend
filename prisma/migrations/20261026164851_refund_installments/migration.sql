-- CreateEnum
CREATE TYPE "RefundInstallmentStatus" AS ENUM ('DUE', 'PAID');

-- CreateTable
CREATE TABLE "RefundInstallment" (
    "id" UUID NOT NULL,
    "cancellationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "RefundInstallmentStatus" NOT NULL DEFAULT 'DUE',
    "paidOn" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "accountId" UUID,
    "paidById" UUID,
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RefundInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundInstallment_status_dueDate_idx" ON "RefundInstallment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RefundInstallment_cancellationId_number_key" ON "RefundInstallment"("cancellationId", "number");

-- AddForeignKey
ALTER TABLE "RefundInstallment" ADD CONSTRAINT "RefundInstallment_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "Cancellation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundInstallment" ADD CONSTRAINT "RefundInstallment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


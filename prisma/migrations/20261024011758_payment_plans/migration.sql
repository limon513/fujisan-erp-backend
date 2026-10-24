-- CreateEnum
CREATE TYPE "InstallmentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "downPaymentType" "ChargeType" NOT NULL DEFAULT 'PERCENT',
    "downPaymentValue" DECIMAL(14,2) NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "frequency" "InstallmentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "interestRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "lateFeeType" "ChargeType" NOT NULL DEFAULT 'FIXED',
    "lateFeeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancellationChargeType" "ChargeType" NOT NULL DEFAULT 'PERCENT',
    "cancellationChargeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentPlan_projectId_isActive_idx" ON "PaymentPlan"("projectId", "isActive");

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "ProjectCostCategory" AS ENUM ('LAND_PURCHASE', 'LAND_REGISTRATION', 'DEVELOPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectCostStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "ProjectCost" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" "ProjectCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "inventoryAccountId" UUID NOT NULL,
    "paidFromAccountId" UUID NOT NULL,
    "reference" TEXT,
    "status" "ProjectCostStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reverseReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "ProjectCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectCost_projectId_status_idx" ON "ProjectCost"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectCost_date_idx" ON "ProjectCost"("date");

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


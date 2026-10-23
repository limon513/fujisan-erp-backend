-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'MEETING');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('SCHEDULED', 'VISITED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteVisitTransport" AS ENUM ('OFFICE_CAR', 'OWN', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('HOT', 'WARM', 'COLD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadActivityType" ADD VALUE 'FOLLOW_UP_SCHEDULED';
ALTER TYPE "LeadActivityType" ADD VALUE 'SITE_VISIT_SCHEDULED';
ALTER TYPE "LeadActivityType" ADD VALUE 'SITE_VISIT';

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" "FollowUpType" NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "purpose" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "doneAt" TIMESTAMPTZ(3),
    "doneById" UUID,
    "cancelReason" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "transport" "SiteVisitTransport" NOT NULL DEFAULT 'OFFICE_CAR',
    "pickupPoint" TEXT,
    "visitors" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "visitedAt" TIMESTAMPTZ(3),
    "interest" "InterestLevel",
    "plotsShown" TEXT,
    "feedback" TEXT,
    "cancelReason" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "completedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowUp_leadId_status_idx" ON "FollowUp"("leadId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_ownerId_status_dueAt_idx" ON "FollowUp"("ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueAt_idx" ON "FollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SiteVisit_leadId_status_idx" ON "SiteVisit"("leadId", "status");

-- CreateIndex
CREATE INDEX "SiteVisit_ownerId_status_scheduledAt_idx" ON "SiteVisit"("ownerId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_status_scheduledAt_idx" ON "SiteVisit"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_projectId_scheduledAt_idx" ON "SiteVisit"("projectId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


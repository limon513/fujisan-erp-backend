-- CreateEnum
CREATE TYPE "AssignmentPoolType" AS ENUM ('TEAM', 'EMPLOYEES');

-- CreateTable
CREATE TABLE "LeadAssignmentRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceId" UUID,
    "projectId" UUID,
    "locationKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "poolType" "AssignmentPoolType" NOT NULL,
    "teamId" UUID,
    "employeeIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAssignedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "LeadAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadAssignmentRule_isActive_priority_idx" ON "LeadAssignmentRule"("isActive", "priority");

-- AddForeignKey
ALTER TABLE "LeadAssignmentRule" ADD CONSTRAINT "LeadAssignmentRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentRule" ADD CONSTRAINT "LeadAssignmentRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignmentRule" ADD CONSTRAINT "LeadAssignmentRule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;


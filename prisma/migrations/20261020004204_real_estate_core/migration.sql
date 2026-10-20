-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ONGOING', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('AVAILABLE', 'HOLD', 'BOOKED', 'SOLD', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Facing" AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST');

-- CreateEnum
CREATE TYPE "PlotHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONVERTED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "customerCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT,
    "motherName" TEXT,
    "spouseName" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "nidNumber" TEXT,
    "passportNumber" TEXT,
    "tin" TEXT,
    "profession" TEXT,
    "organization" TEXT,
    "mobile" TEXT NOT NULL,
    "altMobile" TEXT,
    "email" TEXT,
    "presentAddress" TEXT,
    "permanentAddress" TEXT,
    "photoFileId" UUID,
    "notes" TEXT,
    "ownerId" UUID,
    "teamId" UUID,
    "departmentId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNominee" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "nidNumber" TEXT,
    "mobile" TEXT,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "photoFileId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerNominee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ONGOING',
    "description" TEXT,
    "address" TEXT,
    "district" TEXT,
    "upazila" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "landAreaDecimal" DECIMAL(12,2),
    "launchDate" DATE,
    "expectedHandoverDate" DATE,
    "branchId" UUID,
    "projectManagerId" UUID,
    "layoutFileId" UUID,
    "layoutWidth" INTEGER,
    "layoutHeight" INTEGER,
    "defaultHoldDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Road" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "widthFeet" DECIMAL(6,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "Road_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "roadId" UUID,
    "plotNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "areaSqft" DECIMAL(12,2) NOT NULL,
    "dimensions" TEXT,
    "facing" "Facing",
    "price" DECIMAL(14,2) NOT NULL,
    "status" "PlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mapShape" JSONB,
    "mapLabel" JSONB,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotHold" (
    "id" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "heldById" UUID NOT NULL,
    "customerId" UUID,
    "prospectName" TEXT,
    "prospectMobile" TEXT,
    "reason" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PlotHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "releasedAt" TIMESTAMPTZ(3),
    "releasedById" UUID,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotStatusHistory" (
    "id" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "fromStatus" "PlotStatus",
    "toStatus" "PlotStatus" NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "reason" TEXT,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlotStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotPriceHistory" (
    "id" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "oldPrice" DECIMAL(14,2),
    "newPrice" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlotPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE INDEX "Customer_mobile_idx" ON "Customer"("mobile");

-- CreateIndex
CREATE INDEX "Customer_nidNumber_idx" ON "Customer"("nidNumber");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_branchId_idx" ON "Customer"("branchId");

-- CreateIndex
CREATE INDEX "CustomerNominee_customerId_idx" ON "CustomerNominee"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Block_projectId_code_key" ON "Block"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Road_projectId_name_key" ON "Road"("projectId", "name");

-- CreateIndex
CREATE INDEX "Plot_projectId_status_idx" ON "Plot"("projectId", "status");

-- CreateIndex
CREATE INDEX "Plot_blockId_idx" ON "Plot"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_projectId_code_key" ON "Plot"("projectId", "code");

-- CreateIndex
CREATE INDEX "PlotHold_plotId_createdAt_idx" ON "PlotHold"("plotId", "createdAt");

-- CreateIndex
CREATE INDEX "PlotHold_status_expiresAt_idx" ON "PlotHold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlotStatusHistory_plotId_createdAt_idx" ON "PlotStatusHistory"("plotId", "createdAt");

-- CreateIndex
CREATE INDEX "PlotPriceHistory_plotId_createdAt_idx" ON "PlotPriceHistory"("plotId", "createdAt");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNominee" ADD CONSTRAINT "CustomerNominee_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_layoutFileId_fkey" FOREIGN KEY ("layoutFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Road" ADD CONSTRAINT "Road_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_roadId_fkey" FOREIGN KEY ("roadId") REFERENCES "Road"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_heldById_fkey" FOREIGN KEY ("heldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotHold" ADD CONSTRAINT "PlotHold_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotStatusHistory" ADD CONSTRAINT "PlotStatusHistory_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotPriceHistory" ADD CONSTRAINT "PlotPriceHistory_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DropIndex
DROP INDEX "Session_familyId_idx";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "familyId",
ADD COLUMN     "previousTokenHash" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMPTZ(3);


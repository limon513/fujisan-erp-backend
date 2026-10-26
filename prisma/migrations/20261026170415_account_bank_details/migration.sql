-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "accountTitle" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "isBank" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routingNumber" TEXT,
ADD COLUMN     "swiftCode" TEXT;


-- The seeded "Bank accounts" group and the accounts under it are bank accounts
UPDATE "Account" SET "isBank" = true
WHERE "code" = '1120' OR "parentId" IN (SELECT "id" FROM "Account" WHERE "code" = '1120');

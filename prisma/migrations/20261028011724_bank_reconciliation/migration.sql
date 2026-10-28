-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "fileName" TEXT,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "journalLineId" UUID,
    "matchedById" UUID,
    "matchedAt" TIMESTAMPTZ(3),
    "autoMatched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_accountId_toDate_idx" ON "BankStatement"("accountId", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_journalLineId_key" ON "BankStatementLine"("journalLineId");

-- CreateIndex
CREATE INDEX "BankStatementLine_accountId_status_idx" ON "BankStatementLine"("accountId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_accountId_date_amount_idx" ON "BankStatementLine"("accountId", "date", "amount");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


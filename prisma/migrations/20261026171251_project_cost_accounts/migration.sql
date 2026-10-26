-- The seeded land inventory accounts get their roles for automatic postings
UPDATE "Account" SET "systemKey" = 'LAND_COST'
WHERE "code" = '1210' AND "systemKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "systemKey" = 'LAND_COST');
UPDATE "Account" SET "systemKey" = 'DEVELOPMENT_COST'
WHERE "code" = '1220' AND "systemKey" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "systemKey" = 'DEVELOPMENT_COST');

ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_amount_positive" CHECK ("amount" > 0);

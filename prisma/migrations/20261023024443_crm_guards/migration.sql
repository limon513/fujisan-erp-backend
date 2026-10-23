ALTER TABLE "Lead" ADD CONSTRAINT "Lead_budget_range" CHECK (
  "budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax"
);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lost_has_reason" CHECK (
  "status" <> 'LOST' OR "lostReason" IS NOT NULL
);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_converted_has_customer" CHECK (
  "status" <> 'CONVERTED' OR "convertedCustomerId" IS NOT NULL
);

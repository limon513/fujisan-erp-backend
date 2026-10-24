ALTER TABLE "LeadAssignmentRule" ADD CONSTRAINT "LeadAssignmentRule_pool_matches_type" CHECK (
  ("poolType" = 'TEAM' AND "teamId" IS NOT NULL)
  OR ("poolType" = 'EMPLOYEES' AND cardinality("employeeIds") > 0)
);

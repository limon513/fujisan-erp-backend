-- At most one pending approval per record and process
CREATE UNIQUE INDEX "ApprovalRequest_one_pending_per_entity"
  ON "ApprovalRequest" ("workflowId", "entityType", "entityId")
  WHERE "status" = 'PENDING';

-- A step names exactly the approver its type needs
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approver_matches_type" CHECK (
  ("approverType" = 'ROLE') = ("approverRoleId" IS NOT NULL)
  AND ("approverType" = 'USER') = ("approverUserId" IS NOT NULL)
);

ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_limits_positive" CHECK (
  ("maxAmount" IS NULL OR "maxAmount" >= 0) AND ("maxPercent" IS NULL OR "maxPercent" BETWEEN 0 AND 100)
);

-- A pending request always points at a step
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_pending_has_step" CHECK (
  "status" <> 'PENDING' OR "currentStepOrder" IS NOT NULL
);

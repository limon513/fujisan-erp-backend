ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_done_has_time" CHECK (
  "status" <> 'DONE' OR "doneAt" IS NOT NULL
);
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_visited_has_time" CHECK (
  "status" <> 'VISITED' OR "visitedAt" IS NOT NULL
);
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_visitors_positive" CHECK ("visitors" BETWEEN 1 AND 50);

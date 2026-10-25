import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { definePermissions } from "#core/rbac/permissions.js";
import { FiscalYearRoute } from "./fiscal-year.route.js";

const tags = ["Finance: fiscal years"];
const FiscalYear = z
  .object({
    id: z.uuid(),
    name: z.string().meta({ example: "FY 2026-27" }),
    startDate: z.iso.datetime(),
    endDate: z.iso.datetime(),
    status: z.enum(["OPEN", "CLOSED"]),
    closedAt: z.iso.datetime().nullable(),
    entryCount: z.number().int(),
  })
  .meta({ id: "FiscalYear" });
defineRoute({
  method: "get",
  path: "/fiscal-years",
  tags,
  summary: "Fiscal years (July–June), newest first",
  description: "A year is created automatically on its first posting.",
  response: z.array(FiscalYear),
});
for (const action of ["close", "reopen"]) {
  defineRoute({
    method: "post",
    path: `/fiscal-years/:id/${action}`,
    tags,
    summary:
      action === "close" ? "Close a fiscal year (no more postings)" : "Reopen a closed fiscal year",
    request: { params: z.object({ id: z.uuid() }) },
    response: FiscalYear,
    errors: [400, 401, 403, 404, 409],
  });
}

export default {
  name: "fiscal-year",
  basePath: "/fiscal-years",
  router: FiscalYearRoute,
  core: true,
  permissions: definePermissions({
    module: "finance",
    resource: "fiscal-year",
    label: "Fiscal years",
    actions: ["view", "edit"],
    scoped: false,
  }),
};

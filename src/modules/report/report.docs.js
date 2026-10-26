import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { ReportValidation as V } from "./report.validation.js";

const tags = ["Reports"];
const scope =
  "Requires `report.view`; follows its scope by the booking's sales executive (+ org). Money as decimal strings.";
const Any = z.record(z.string(), z.unknown());

defineRoute({
  method: "get",
  path: "/reports/overview",
  tags,
  summary: "This month, the last 12 months (booked vs collected) and receivables aging",
  description: scope,
  response: z.object({ thisMonth: Any, trend: z.array(Any), receivables: Any }),
});
defineRoute({
  method: "get",
  path: "/reports/sales",
  tags,
  summary: "Bookings confirmed in a period, by project and salesperson",
  description: `${scope} Also registrations, cancellations and transfers in the period.`,
  request: { query: V.period },
  response: z.object({
    totals: Any,
    byProject: z.array(Any),
    bySalesperson: z.array(Any),
    bookings: z.array(Any),
  }),
  errors: [400, 401, 403],
});
defineRoute({
  method: "get",
  path: "/reports/collections",
  tags,
  summary:
    "Verified payments in a period, by method, account, project and day (month beyond 62 days)",
  description: `${scope} Includes what fell due in the period and how much of it is paid (collection rate), and refunds paid.`,
  request: { query: V.period },
  response: z.object({
    totals: Any,
    byMethod: z.array(Any),
    byAccount: z.array(Any),
    byProject: z.array(Any),
    trend: z.object({ unit: z.enum(["day", "month"]), points: z.array(Any) }),
    payments: z.array(Any),
  }),
  errors: [400, 401, 403],
});
defineRoute({
  method: "get",
  path: "/reports/outstanding",
  tags,
  summary: "What each live booking still owes, most overdue first, with aging",
  description: `${scope} Aging buckets by days past due: not yet due, 1–30, 31–60, 61–90, over 90.`,
  request: { query: V.outstanding },
  response: z.object({ rows: z.array(Any), totals: Any }),
  errors: [400, 401, 403],
});
defineRoute({
  method: "get",
  path: "/reports/customers/:id/statement",
  tags,
  summary: "Customer statement: bookings, balances and every receipt, refund and transfer",
  description: `${scope} The customer must be in scope, or have a booking in scope.`,
  request: { params: V.idParams },
  response: z.object({ customer: Any, bookings: z.array(Any), lines: z.array(Any), totals: Any }),
  errors: [400, 401, 403, 404],
});

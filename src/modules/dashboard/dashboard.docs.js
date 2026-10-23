import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";

const counts = z.record(z.string(), z.number().int());
const hold = z.object({
  id: z.uuid(),
  days: z.number().int(),
  reason: z.string(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  prospectName: z.string().nullable(),
  plot: z.object({
    id: z.uuid(),
    code: z.string(),
    project: z.object({ id: z.uuid(), name: z.string() }),
  }),
  requestedBy: z.object({ id: z.uuid(), fullName: z.string() }),
  customer: z.object({ id: z.uuid(), fullName: z.string(), customerCode: z.string() }).nullable(),
});

defineRoute({
  method: "get",
  path: "/dashboard/summary",
  tags: ["Dashboard"],
  summary: "Role-aware dashboard numbers",
  description:
    "Requires `dashboard.view`. Sections appear only with the matching permission: `inventory` + `expiringHolds` (plot.view), `customers` (customer.view, counted within your data scope), `people` (employee.view); `myHolds` for users linked to an employee.",
  response: z.object({
    generatedAt: z.iso.datetime(),
    inventory: z
      .object({
        totals: counts,
        availableValue: z.string().meta({ description: "Sum of prices of available plots (BDT)" }),
        activeHolds: z.number().int(),
        projects: z.array(
          z.object({ id: z.uuid(), code: z.string(), name: z.string(), plots: counts }),
        ),
      })
      .optional(),
    expiringHolds: z
      .array(hold)
      .optional()
      .meta({ description: "Active holds ending within 48 hours" }),
    myHolds: z.array(hold).optional(),
    customers: z
      .object({ total: z.number().int(), newThisMonth: z.number().int(), scope: z.string() })
      .optional(),
    people: z.object({ activeEmployees: z.number().int() }).optional(),
  }),
  errors: [401, 403],
});

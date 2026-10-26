import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { ProjectCostValidation as V } from "./project-cost.validation.js";

const tags = ["Finance: project costs"];
const Any = z.record(z.string(), z.unknown());

const Cost = z
  .object({
    id: z.uuid(),
    date: z.iso.datetime(),
    category: z.enum(["LAND_PURCHASE", "LAND_REGISTRATION", "DEVELOPMENT", "OTHER"]),
    description: z.string(),
    amount: z.string(),
    reference: z.string().nullable(),
    status: z.enum(["POSTED", "REVERSED"]),
    project: Any,
    inventoryAccount: Any,
    paidFromAccount: Any,
  })
  .meta({ id: "ProjectCost" });

defineRoute({
  method: "get",
  path: "/project-costs",
  tags,
  summary: "Recorded project costs, newest first",
  request: { query: V.list },
  response: Cost,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/project-costs/summary",
  tags,
  summary: "A project's land cost, cost of sales so far, cost per unsold sqft and gross profit",
  description:
    "Each plot registered takes the cost still in inventory × its share of the area still unsold.",
  request: { query: V.summary },
  response: z.object({
    totalCost: z.string(),
    byCategory: z.array(Any),
    costOfSales: z.string(),
    inventoryLeft: z.string(),
    area: Any,
    costPerSqftUnsold: z.string().nullable(),
    registered: Any,
  }),
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/project-costs",
  tags,
  summary: "Record a project cost",
  description:
    "Posts Dr Land purchase cost (land purchase, land registration) or Land development cost (development, other) / Cr the account paid from (cash, bank or a payable).",
  request: { body: V.create },
  response: Cost,
  status: 201,
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "post",
  path: "/project-costs/:id/reverse",
  tags,
  summary: "Reverse a recorded cost",
  description:
    "Requires `project-cost.reverse`. Posts the mirror entry; the record stays, marked reversed.",
  request: { params: V.idParams, body: V.reverse },
  response: Cost,
  errors: [400, 401, 403, 404, 409],
});

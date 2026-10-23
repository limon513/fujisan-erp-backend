import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { CampaignValidation as V } from "./campaign.validation.js";

const tags = ["CRM: campaigns"];
const base = "/campaigns";

const Campaign = z
  .object({
    id: z.uuid(),
    name: z.string(),
    source: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    budget: z.string().nullable(),
    startDate: z.iso.datetime().nullable(),
    endDate: z.iso.datetime().nullable(),
    externalId: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    leadCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Campaign" });

defineRoute({
  method: "get",
  path: base,
  tags,
  summary: "List campaigns",
  request: { query: V.list },
  response: Campaign,
  paginated: true,
});
defineRoute({
  method: "get",
  path: `${base}/:id`,
  tags,
  summary: "Get campaign",
  request: { params: V.idParams },
  response: Campaign,
  errors: [401, 403, 404],
});
defineRoute({
  method: "post",
  path: base,
  tags,
  summary: "Create campaign",
  request: { body: V.create },
  response: Campaign,
  status: 201,
  errors: [400, 401, 403, 409],
});
defineRoute({
  method: "patch",
  path: `${base}/:id`,
  tags,
  summary: "Update campaign",
  request: { params: V.idParams, body: V.update },
  response: Campaign,
  errors: [400, 401, 403, 404, 409],
});
defineRoute({
  method: "delete",
  path: `${base}/:id`,
  tags,
  summary: "Delete campaign",
  request: { params: V.idParams },
  errors: [401, 403, 404, 409],
});

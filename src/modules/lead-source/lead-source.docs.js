import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { LeadSourceValidation as V } from "./lead-source.validation.js";

const tags = ["CRM: lead sources"];
const base = "/lead-sources";

const LeadSource = z
  .object({
    id: z.uuid(),
    code: z.string().meta({ example: "FACEBOOK", description: "Generated from the first name" }),
    name: z.string(),
    isActive: z.boolean(),
    sortOrder: z.number().int(),
    leadCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "LeadSource" });

defineRoute({
  method: "get",
  path: base,
  tags,
  summary: "List lead sources",
  request: { query: V.list },
  response: LeadSource,
  paginated: true,
});
defineRoute({
  method: "get",
  path: `${base}/:id`,
  tags,
  summary: "Get lead source",
  request: { params: V.idParams },
  response: LeadSource,
  errors: [401, 403, 404],
});
defineRoute({
  method: "post",
  path: base,
  tags,
  summary: "Create lead source",
  request: { body: V.create },
  response: LeadSource,
  status: 201,
  errors: [400, 401, 403, 409],
});
defineRoute({
  method: "patch",
  path: `${base}/:id`,
  tags,
  summary: "Update lead source",
  request: { params: V.idParams, body: V.update },
  response: LeadSource,
  errors: [400, 401, 403, 404, 409],
});
defineRoute({
  method: "delete",
  path: `${base}/:id`,
  tags,
  summary: "Delete lead source",
  description: "Only while no lead uses it; otherwise switch it off (isActive: false).",
  request: { params: V.idParams },
  errors: [401, 403, 404, 409],
});

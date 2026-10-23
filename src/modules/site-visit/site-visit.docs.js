import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { INTEREST_LEVELS, TRANSPORTS, VISIT_STATUSES } from "./site-visit.constant.js";
import { SiteVisitValidation as V } from "./site-visit.validation.js";

const tags = ["CRM: site visits"];

const SiteVisit = z
  .object({
    id: z.uuid(),
    scheduledAt: z.iso.datetime(),
    transport: z.enum(TRANSPORTS),
    pickupPoint: z.string().nullable(),
    visitors: z.number().int(),
    note: z.string().nullable(),
    status: z.enum(VISIT_STATUSES),
    visitedAt: z.iso.datetime().nullable(),
    interest: z.enum(INTEREST_LEVELS).nullable(),
    plotsShown: z.string().nullable(),
    feedback: z.string().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lead: z.object({
      id: z.uuid(),
      leadCode: z.string(),
      fullName: z.string(),
      mobile: z.string(),
      status: z.string(),
    }),
    project: z.object({ id: z.uuid(), name: z.string() }),
    owner: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
  })
  .meta({ id: "SiteVisit" });

const scopeNote =
  "Follows the data scope of `site-visit.*`: a visit belongs to the employee going along (the lead's assigned employee by default).";

defineRoute({
  method: "get",
  path: "/site-visits",
  tags,
  summary: "Site visits by bucket",
  description: `today / upcoming / missed (scheduled before today, never closed) / open are SCHEDULED visits in Dhaka days; past = visited, no-show or cancelled. ${scopeNote}`,
  request: { query: V.list },
  response: SiteVisit,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/site-visits/counts",
  tags,
  summary: "How many visits are today, later, and missed",
  request: { query: V.counts },
  response: z.object({ today: z.number(), upcoming: z.number(), missed: z.number() }),
});
defineRoute({
  method: "get",
  path: "/site-visits/:id",
  tags,
  summary: "One site visit",
  request: { params: V.idParams },
  response: SiteVisit,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/site-visits",
  tags,
  summary: "Book a site visit for a lead",
  description: `The lead moves on to SITE_VISIT (never backwards) and the employee going along is notified; reminded 2 hours before. ${scopeNote}`,
  request: { body: V.create },
  response: SiteVisit,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "patch",
  path: "/site-visits/:id",
  tags,
  summary: "Change a scheduled visit",
  request: { params: V.idParams, body: V.update },
  response: SiteVisit,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/site-visits/:id/complete",
  tags,
  summary: "Record the visit (visited or no-show)",
  description: "VISITED needs the interest level. Logged on the lead's timeline.",
  request: { params: V.idParams, body: V.complete },
  response: SiteVisit,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/site-visits/:id/cancel",
  tags,
  summary: "Cancel a scheduled visit",
  request: { params: V.idParams, body: V.cancel },
  response: SiteVisit,
  errors: [400, 401, 403, 404, 409],
});

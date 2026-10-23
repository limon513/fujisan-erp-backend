import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { FOLLOW_UP_TYPES } from "./follow-up.constant.js";
import { FollowUpValidation as V } from "./follow-up.validation.js";

const tags = ["CRM: follow-ups"];
const Person = z.object({ id: z.uuid(), name: z.string() });

const FollowUp = z
  .object({
    id: z.uuid(),
    type: z.enum(FOLLOW_UP_TYPES),
    dueAt: z.iso.datetime(),
    purpose: z.string().nullable(),
    status: z.enum(["PENDING", "DONE", "CANCELLED"]),
    outcome: z.string().nullable(),
    doneAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lead: z.object({
      id: z.uuid(),
      leadCode: z.string(),
      fullName: z.string(),
      mobile: z.string(),
      status: z.string(),
    }),
    owner: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
    doneBy: Person.nullable(),
  })
  .meta({ id: "FollowUp" });

const scopeNote =
  "Follows the data scope of `follow-up.*`: a follow-up belongs to the employee who should do it (the lead's assigned employee by default).";

defineRoute({
  method: "get",
  path: "/follow-ups",
  tags,
  summary: "Follow-ups by due bucket",
  description: `overdue / today / upcoming / open are PENDING ones (Dhaka days), oldest first; done covers the last 30 days. ${scopeNote}`,
  request: { query: V.list },
  response: FollowUp,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/follow-ups/counts",
  tags,
  summary: "How many follow-ups are overdue, due today and later",
  request: { query: V.counts },
  response: z.object({ overdue: z.number(), today: z.number(), upcoming: z.number() }),
});
defineRoute({
  method: "get",
  path: "/follow-ups/:id",
  tags,
  summary: "One follow-up",
  request: { params: V.idParams },
  response: FollowUp,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/follow-ups",
  tags,
  summary: "Schedule a follow-up for a lead",
  description: `Logged on the lead's timeline; the lead's next follow-up is updated and the employee notified. Not for lost leads. ${scopeNote}`,
  request: { body: V.create },
  response: FollowUp,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "patch",
  path: "/follow-ups/:id",
  tags,
  summary: "Reschedule or reassign a pending follow-up",
  request: { params: V.idParams, body: V.update },
  response: FollowUp,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "post",
  path: "/follow-ups/:id/complete",
  tags,
  summary: "Mark done with what happened",
  description:
    "The outcome is logged on the lead (a first contact moves a NEW lead to CONTACTED). `next` schedules the following one.",
  request: { params: V.idParams, body: V.complete },
  response: FollowUp,
  errors: [400, 401, 403, 404, 409],
});
defineRoute({
  method: "post",
  path: "/follow-ups/:id/cancel",
  tags,
  summary: "Cancel a pending follow-up",
  request: { params: V.idParams, body: V.cancel },
  response: FollowUp,
  errors: [400, 401, 403, 404, 409],
});

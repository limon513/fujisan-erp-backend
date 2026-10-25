import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { JournalValidation as V } from "./journal.validation.js";

const tags = ["Finance: journal"];

const Entry = z
  .object({
    id: z.uuid(),
    entryNo: z.string().meta({ example: "JV-000001" }),
    date: z.iso.datetime(),
    narration: z.string(),
    kind: z.enum(["MANUAL", "AUTO", "REVERSAL"]),
    sourceType: z.string().nullable(),
    sourceId: z.string().nullable(),
    link: z
      .string()
      .nullable()
      .meta({ description: "Frontend path of the record behind an automatic entry" }),
    total: z.string(),
    fiscalYear: z.object({ id: z.uuid(), name: z.string(), status: z.string() }),
    lines: z.array(
      z.object({
        debit: z.string(),
        credit: z.string(),
        description: z.string().nullable(),
        account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
      }),
    ),
  })
  .meta({ id: "JournalEntry" });

defineRoute({
  method: "get",
  path: "/journals",
  tags,
  summary: "Journal entries, newest first",
  request: { query: V.list },
  response: Entry,
  paginated: true,
});
defineRoute({
  method: "get",
  path: "/journals/:id",
  tags,
  summary: "One journal entry",
  request: { params: V.idParams },
  response: Entry,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/journals",
  tags,
  summary: "Post a manual journal entry",
  description:
    "Requires `journal.create`. Debits must equal credits (also enforced by the database); postable (non-group, active) accounts only; the date's fiscal year must be open (created on first use).",
  request: { body: V.create },
  response: Entry,
  status: 201,
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "post",
  path: "/journals/:id/reverse",
  tags,
  summary: "Reverse a manual entry",
  description:
    "Requires `journal.reverse`. Posts the mirror entry; automatic entries are undone from their record.",
  request: { params: V.idParams, body: V.reverse },
  response: Entry,
  errors: [400, 401, 403, 404, 409, 422],
});

import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { BankReconciliationValidation as V } from "./bank-reconciliation.validation.js";

const tags = ["Finance: bank reconciliation"];
const Any = z.record(z.string(), z.unknown());
const Statement = z
  .object({
    id: z.uuid(),
    account: Any,
    fromDate: z.iso.datetime(),
    toDate: z.iso.datetime(),
    closingBalance: z.string(),
    lines: z.array(Any),
    counts: Any,
    summary: z.object({
      bookBalance: z.string(),
      notOnStatement: z.string(),
      notInBooks: z.string(),
      adjustedBalance: z.string(),
      statementBalance: z.string(),
      difference: z.string(),
      balancesTie: z.boolean(),
      reconciled: z
        .boolean()
        .meta({ description: "Balances tie and every statement line is matched or ignored" }),
      uncleared: z.array(Any),
      unbooked: z.array(Any),
    }),
  })
  .meta({ id: "BankStatement" });

defineRoute({
  method: "get",
  path: "/bank-reconciliation/accounts",
  tags,
  summary: "Accounts that take bank statements (bank and mobile accounts)",
  response: z.array(Any),
});
defineRoute({
  method: "get",
  path: "/bank-reconciliation/statements",
  tags,
  summary: "Imported statements, newest first",
  request: { query: V.list },
  response: z.array(Any),
});
defineRoute({
  method: "get",
  path: "/bank-reconciliation/statements/:id",
  tags,
  summary: "A statement with its lines and the reconciliation summary",
  description:
    "Book balance − book lines not yet on a statement + statement lines not yet in the books = the statement's closing balance when reconciled.",
  request: { params: V.idParams },
  response: Statement,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/bank-reconciliation/statements",
  tags,
  summary: "Import a statement (lines parsed from the bank's CSV)",
  description:
    "Lines already imported (same date, amount and description) are skipped. Matching book lines (same amount within 5 days, a shared reference first) are matched automatically.",
  request: { body: V.importStatement },
  response: Statement,
  status: 201,
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "delete",
  path: "/bank-reconciliation/statements/:id",
  tags,
  summary: "Remove an imported statement (its matches are undone)",
  request: { params: V.idParams },
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "get",
  path: "/bank-reconciliation/lines/:id/candidates",
  tags,
  summary: "Unreconciled book entries with the same amount, nearest date first",
  request: { params: V.idParams },
  response: z.array(Any),
  errors: [400, 401, 403, 404],
});
for (const [action, summary, body] of [
  ["match", "Match a statement line to a book entry", V.match],
  ["unmatch", "Undo a match", null],
  ["ignore", "Mark a line as not for the books (or undo)", V.ignore],
  ["book", "Post a line the books don't have yet (bank charges, interest) and match it", V.book],
]) {
  defineRoute({
    method: "post",
    path: `/bank-reconciliation/lines/:id/${action}`,
    tags,
    summary,
    request: { params: V.idParams, ...(body && { body }) },
    response: Statement,
    errors: [400, 401, 403, 404, 409, 422],
  });
}

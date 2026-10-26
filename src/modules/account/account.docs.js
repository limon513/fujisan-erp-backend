import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { AccountValidation as V } from "./account.validation.js";

const tags = ["Finance: accounts"];
const Type = z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]);

const Account = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    type: Type,
    parentId: z.uuid().nullable(),
    isGroup: z.boolean(),
    isActive: z.boolean(),
    systemKey: z
      .string()
      .nullable()
      .meta({ description: "Used by automatic postings (CASH, CUSTOMER_ADVANCE, ...)" }),
    description: z.string().nullable(),
    isBank: z.boolean().meta({ description: "A bank account: carries bank details" }),
    bankName: z.string().nullable(),
    bankBranch: z.string().nullable(),
    accountTitle: z.string().nullable(),
    accountNumber: z.string().nullable(),
    routingNumber: z.string().nullable(),
    swiftCode: z.string().nullable(),
    balance: z
      .string()
      .optional()
      .meta({ description: "In the account's normal direction; groups sum their accounts" }),
  })
  .meta({ id: "Account" });

defineRoute({
  method: "get",
  path: "/accounts",
  tags,
  summary: "Chart of accounts (by code)",
  request: { query: V.list },
  response: z.array(Account),
});
defineRoute({
  method: "get",
  path: "/accounts/trial-balance",
  tags,
  summary: "Trial balance as of a date",
  request: { query: V.trialBalance },
  response: z.object({
    asOf: z.iso.datetime(),
    rows: z.array(
      z.object({
        id: z.uuid(),
        code: z.string(),
        name: z.string(),
        type: Type,
        debit: z.string(),
        credit: z.string(),
      }),
    ),
    totalDebit: z.string(),
    totalCredit: z.string(),
    balanced: z.boolean(),
  }),
});
defineRoute({
  method: "get",
  path: "/accounts/:id",
  tags,
  summary: "One account",
  request: { params: V.idParams },
  response: Account,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "get",
  path: "/accounts/:id/ledger",
  tags,
  summary: "Account ledger with opening and running balance",
  request: { params: V.idParams, query: V.ledger },
  response: z.object({
    account: Account,
    openingBalance: z.string(),
    totalDebit: z.string(),
    totalCredit: z.string(),
    closingBalance: z.string(),
    lines: z.array(z.record(z.string(), z.unknown())),
  }),
  errors: [400, 401, 403, 404, 422],
});
defineRoute({
  method: "post",
  path: "/accounts",
  tags,
  summary: "Add an account",
  description:
    "Under a group (type follows it), or top-level with a type. Under a bank group it is a bank account and keeps the bank details (bank, branch, title, number, routing, SWIFT).",
  request: { body: V.create },
  response: Account,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "patch",
  path: "/accounts/:id",
  tags,
  summary: "Rename, renumber or switch off an account",
  description: "Accounts used by automatic postings can't be switched off.",
  request: { params: V.idParams, body: V.update },
  response: Account,
  errors: [400, 401, 403, 404, 409, 422],
});
defineRoute({
  method: "delete",
  path: "/accounts/:id",
  tags,
  summary: "Delete an unused account",
  description:
    "Only accounts never posted to, without sub-accounts, and not used by automatic postings.",
  request: { params: V.idParams },
  errors: [401, 403, 404, 409],
});

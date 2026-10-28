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

const Rows = z.object({ rows: z.array(z.record(z.string(), z.unknown())), total: z.string() });

defineRoute({
  method: "get",
  path: "/accounts/profit-and-loss",
  tags,
  summary: "Profit and loss for a period",
  description:
    "Income and expense accounts (indented, groups summed) for the period, with gross profit (plot sales − cost of plots sold) and net profit. Default period: the fiscal year to date.",
  request: { query: V.period },
  response: z.object({
    income: Rows,
    expenses: Rows,
    grossProfit: z.record(z.string(), z.unknown()),
    netProfit: z.string(),
    margin: z.number().nullable(),
  }),
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "get",
  path: "/accounts/balance-sheet",
  tags,
  summary: "Balance sheet as of a date",
  description:
    "Assets = liabilities + equity. Fiscal years are locked, not closed into retained earnings, so profit shows in equity as earlier years and this fiscal year.",
  request: { query: V.trialBalance },
  response: z.object({
    assets: Rows,
    liabilities: Rows,
    equity: Rows,
    liabilitiesAndEquity: z.string(),
    balanced: z.boolean(),
  }),
  errors: [400, 401, 403],
});
defineRoute({
  method: "get",
  path: "/accounts/cash-book",
  tags,
  summary: "Cash and bank book",
  description:
    "Opening, receipts, payments and closing of every cash, bank and mobile account, and the dated lines of one (or all) with the accounts on the other side and a running balance.",
  request: { query: V.cashBook },
  response: z.object({
    accounts: z.array(z.record(z.string(), z.unknown())),
    lines: z.array(z.record(z.string(), z.unknown())),
    opening: z.string(),
    closing: z.string(),
  }),
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "get",
  path: "/accounts/cash-flow",
  tags,
  summary: "Cash flow statement (direct method)",
  description:
    "Money in and out by the account on the other side, in operating, investing and financing activities; moves between money accounts are left out. Opening + net change = closing.",
  request: { query: V.period },
  response: z.object({
    sections: z.array(z.record(z.string(), z.unknown())),
    netChange: z.string(),
    opening: z.string(),
    closing: z.string(),
    reconciles: z.boolean(),
  }),
  errors: [400, 401, 403, 422],
});

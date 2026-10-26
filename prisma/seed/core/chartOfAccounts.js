/**
 * Default chart of accounts for a Bangladeshi real-estate (land/plot) developer.
 * [code, name, type, { group, key, parent }] — `key` is the systemKey used by automatic postings.
 * Created once per code; renames and new accounts made in the app are kept.
 */
export const chartOfAccounts = [
  ["1000", "Assets", "ASSET", { group: true }],
  ["1100", "Current assets", "ASSET", { group: true, parent: "1000" }],
  ["1110", "Cash in hand", "ASSET", { parent: "1100", key: "CASH" }],
  ["1120", "Bank accounts", "ASSET", { group: true, parent: "1100", bank: true }],
  ["1121", "Main bank account", "ASSET", { parent: "1120", key: "BANK", bank: true }],
  ["1130", "Mobile financial services", "ASSET", { group: true, parent: "1100" }],
  ["1131", "bKash merchant account", "ASSET", { parent: "1130", key: "BKASH" }],
  ["1132", "Nagad merchant account", "ASSET", { parent: "1130", key: "NAGAD" }],
  ["1140", "Customer receivable", "ASSET", { parent: "1100", key: "CUSTOMER_RECEIVABLE" }],
  ["1150", "Advances, deposits and prepayments", "ASSET", { parent: "1100" }],
  ["1200", "Land and development (inventory)", "ASSET", { group: true, parent: "1000" }],
  ["1210", "Land purchase cost", "ASSET", { parent: "1200", key: "LAND_COST" }],
  ["1220", "Land development cost", "ASSET", { parent: "1200", key: "DEVELOPMENT_COST" }],
  ["1300", "Fixed assets", "ASSET", { group: true, parent: "1000" }],
  ["1310", "Office equipment", "ASSET", { parent: "1300" }],
  ["1320", "Furniture and fixtures", "ASSET", { parent: "1300" }],
  ["1330", "Vehicles", "ASSET", { parent: "1300" }],

  ["2000", "Liabilities", "LIABILITY", { group: true }],
  ["2100", "Current liabilities", "LIABILITY", { group: true, parent: "2000" }],
  [
    "2110",
    "Customer advances (booking money and installments)",
    "LIABILITY",
    { parent: "2100", key: "CUSTOMER_ADVANCE" },
  ],
  ["2120", "Accounts payable (suppliers)", "LIABILITY", { parent: "2100" }],
  ["2130", "Contractor payable", "LIABILITY", { parent: "2100" }],
  ["2140", "Salaries payable", "LIABILITY", { parent: "2100" }],
  ["2150", "Customer refunds payable", "LIABILITY", { parent: "2100", key: "REFUND_PAYABLE" }],
  ["2160", "VAT payable", "LIABILITY", { parent: "2100" }],
  ["2170", "AIT / TDS payable", "LIABILITY", { parent: "2100" }],
  ["2200", "Long-term loans", "LIABILITY", { group: true, parent: "2000" }],
  ["2210", "Bank loan", "LIABILITY", { parent: "2200" }],

  ["3000", "Equity", "EQUITY", { group: true }],
  ["3100", "Share capital", "EQUITY", { parent: "3000" }],
  ["3200", "Retained earnings", "EQUITY", { parent: "3000", key: "RETAINED_EARNINGS" }],

  ["4000", "Income", "INCOME", { group: true }],
  ["4100", "Plot sales revenue", "INCOME", { parent: "4000", key: "SALES_REVENUE" }],
  ["4200", "Installment interest income", "INCOME", { parent: "4000", key: "INTEREST_INCOME" }],
  ["4300", "Late fee income", "INCOME", { parent: "4000", key: "LATE_FEE_INCOME" }],
  ["4400", "Cancellation charge income", "INCOME", { parent: "4000", key: "CANCELLATION_INCOME" }],
  [
    "4500",
    "Ownership transfer fee income",
    "INCOME",
    { parent: "4000", key: "TRANSFER_FEE_INCOME" },
  ],
  ["4900", "Other income", "INCOME", { parent: "4000" }],

  ["5000", "Expenses", "EXPENSE", { group: true }],
  ["5100", "Cost of plots sold", "EXPENSE", { parent: "5000", key: "COST_OF_SALES" }],
  ["5200", "Salaries and allowances", "EXPENSE", { parent: "5000" }],
  ["5300", "Sales commission", "EXPENSE", { parent: "5000" }],
  ["5400", "Marketing and advertising", "EXPENSE", { parent: "5000" }],
  ["5500", "Office rent", "EXPENSE", { parent: "5000" }],
  ["5600", "Utilities", "EXPENSE", { parent: "5000" }],
  ["5700", "Bank and MFS charges", "EXPENSE", { parent: "5000" }],
  ["5800", "Registration and legal expenses", "EXPENSE", { parent: "5000" }],
  ["5900", "Other expenses", "EXPENSE", { parent: "5000" }],
];

/** Creates missing accounts (by code), parents first. Returns how many were created. */
export async function syncChartOfAccounts(tx, accounts = chartOfAccounts) {
  let created = 0;
  const ids = new Map(
    (await tx.account.findMany({ select: { id: true, code: true } })).map((a) => [a.code, a.id]),
  );
  for (const [
    code,
    name,
    type,
    { group = false, key = null, parent = null, bank = false } = {},
  ] of accounts) {
    if (ids.has(code)) continue;
    const account = await tx.account.create({
      data: {
        code,
        name,
        type,
        isGroup: group,
        isBank: bank,
        systemKey: key,
        parentId: parent ? ids.get(parent) : null,
      },
    });
    ids.set(code, account.id);
    created += 1;
  }
  return created;
}

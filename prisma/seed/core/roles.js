/**
 * System roles (blueprint §3) with default permission templates.
 *
 * A template is an ordered list of [pattern, scope] rules (later rules win; scope null = don't grant).
 * Patterns: "lead.view", "lead.*", "*.view", "*". Patterns may name resources whose modules don't
 * exist yet — they start matching when the module ships.
 *
 * Templates are applied only when a permission is first added to the catalog (or a role is first
 * created), so later edits made in the permission-matrix UI are never overwritten by a re-seed.
 */

// Resource groups (permission key prefixes) used by several roles
const SALES = [
  "lead",
  "lead-source",
  "campaign",
  "follow-up",
  "site-visit",
  "customer",
  "quotation",
  "discount-request",
  "booking",
];
const INVENTORY_VIEW = ["project", "plot"];
const FINANCE = [
  "collection",
  "emi",
  "cancellation",
  "refund",
  "account",
  "journal",
  "fiscal-year",
  "bank-reconciliation",
];
const HR = ["employee", "attendance", "leave", "payroll", "target", "commission"];
const ORG = ["branch", "department", "designation", "team"];
const PURCHASE = [
  "purchase-request",
  "rfq",
  "purchase-order",
  "goods-receipt",
  "vendor",
  "vendor-invoice",
];
const STOCK = ["item", "item-category", "warehouse", "stock-movement"];
const CONSTRUCTION = [
  "project-task",
  "milestone",
  "contractor",
  "site-activity",
  "project-expense",
];

const each = (resources, action, scope) =>
  resources.map((resource) => [`${resource}.${action}`, scope]);
const all = (resources, scope) => each(resources, "*", scope);

// Plots: holding and pricing are management decisions (client rule: Sales Manager and above hold)
const PLOT_CONTROL = [
  ["plot.hold", "ALL"],
  ["plot.price", "ALL"],
  ["plot.block", "ALL"],
];

const EVERYONE = [
  ["dashboard.view", "OWN"],
  ["notification.*", "OWN"],
];

const MANAGEMENT = [
  ...EVERYONE,
  ["*.view", "ALL"],
  ["*.approve", "ALL"],
  ["*.export", "ALL"],
  ["*.print", "ALL"],
  ...PLOT_CONTROL,
];

export const systemRoles = [
  {
    slug: "super-admin",
    name: "Super Admin",
    level: 100,
    require2FA: true,
    description: "Full access to everything, including system settings.",
    template: [["*", "ALL"]],
  },
  {
    slug: "chairman",
    name: "Chairman",
    level: 95,
    require2FA: true,
    template: MANAGEMENT,
  },
  {
    slug: "managing-director",
    name: "Managing Director",
    level: 90,
    require2FA: true,
    template: MANAGEMENT,
  },
  {
    slug: "director",
    name: "Director",
    level: 85,
    require2FA: true,
    template: MANAGEMENT,
  },
  {
    slug: "gm-dgm",
    name: "GM/DGM",
    level: 80,
    require2FA: true,
    template: [
      ...EVERYONE,
      ["*.view", "ALL"],
      ["*.approve", "ALL"],
      ["*.export", "ALL"],
      ["*.print", "ALL"],
      ["audit-log.view", null],
      ["setting.view", null],
      ...PLOT_CONTROL,
    ],
  },
  {
    slug: "department-head",
    name: "Department Head",
    level: 70,
    template: [
      ...EVERYONE,
      ["*.view", "DEPARTMENT"],
      ["*.approve", "DEPARTMENT"],
      ["*.export", "DEPARTMENT"],
      ["*.print", "DEPARTMENT"],
      ["audit-log.view", null],
      ["setting.view", null],
      ["role.view", null],
      ["user.view", null],
    ],
  },
  {
    slug: "sales-manager",
    name: "Sales Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(SALES, "BRANCH"),
      ["lead-assignment-rule.*", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
      ["plot.hold", "ALL"],
      ["emi.view", "BRANCH"],
      ["collection.view", "BRANCH"],
      ["cancellation.view", "BRANCH"],
      ["cancellation.create", "BRANCH"],
      ["target.view", "BRANCH"],
      ["commission.view", "BRANCH"],
      ["employee.view", "BRANCH"],
      ["team.view", "BRANCH"],
      ["report.view", "BRANCH"],
    ],
  },
  {
    slug: "team-leader",
    name: "Team Leader",
    level: 50,
    template: [
      ...EVERYONE,
      ...all(SALES, "TEAM"),
      ...each(SALES, "delete", null),
      ...each(INVENTORY_VIEW, "view", "ALL"),
      ["emi.view", "TEAM"],
      ["collection.view", "TEAM"],
      ["target.view", "TEAM"],
      ["commission.view", "TEAM"],
      ["employee.view", "TEAM"],
      ["report.view", "TEAM"],
    ],
  },
  {
    slug: "sales-executive",
    name: "Sales Executive",
    level: 30,
    template: [
      ...EVERYONE,
      ["lead.view", "OWN"],
      ["lead.create", "OWN"],
      ["lead.edit", "OWN"],
      ...all(["follow-up", "site-visit"], "OWN"),
      ["follow-up.delete", null],
      ["site-visit.delete", null],
      ["customer.view", "OWN"],
      ["customer.create", "OWN"],
      ["customer.edit", "OWN"],
      ["quotation.view", "OWN"],
      ["quotation.create", "OWN"],
      ["discount-request.view", "OWN"],
      ["discount-request.create", "OWN"],
      ["booking.view", "OWN"],
      ["booking.create", "OWN"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
      ["emi.view", "OWN"],
      ["collection.view", "OWN"],
      ["target.view", "OWN"],
      ["commission.view", "OWN"],
    ],
  },
  {
    slug: "crm-executive",
    name: "CRM Executive",
    level: 30,
    template: [
      ...EVERYONE,
      ...all(["lead", "follow-up", "site-visit", "lead-source", "lead-assignment-rule"], "ALL"),
      ["lead.delete", null],
      ["customer.view", "ALL"],
      ["customer.edit", "ALL"],
      ["booking.view", "ALL"],
      ["emi.view", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
    ],
  },
  {
    slug: "accounts-manager",
    name: "Accounts Manager",
    level: 60,
    require2FA: true,
    template: [
      ...EVERYONE,
      ...all(FINANCE, "ALL"),
      ["booking.view", "ALL"],
      ["booking.approve", "ALL"],
      ["customer.view", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
      ["payroll.view", "ALL"],
      ["payroll.approve", "ALL"],
      ["vendor-invoice.*", "ALL"],
      ["report.*", "ALL"],
    ],
  },
  {
    slug: "accountant",
    name: "Accountant",
    level: 40,
    require2FA: true,
    template: [
      ...EVERYONE,
      ["collection.view", "ALL"],
      ["collection.create", "ALL"],
      ["collection.edit", "ALL"],
      ["collection.print", "ALL"],
      ["emi.view", "ALL"],
      ["journal.view", "ALL"],
      ["journal.create", "ALL"],
      ["account.view", "ALL"],
      ["refund.view", "ALL"],
      ["cancellation.view", "ALL"],
      ["booking.view", "ALL"],
      ["customer.view", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
    ],
  },
  {
    slug: "hr-manager",
    name: "HR Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(HR, "ALL"),
      ...all(ORG, "ALL"),
      ["user.view", "ALL"],
      ["user.create", "ALL"],
      ["user.edit", "ALL"],
      ["user.reset-password", "ALL"],
      ["role.view", "ALL"],
      ["report.view", "ALL"],
    ],
  },
  {
    slug: "hr-executive",
    name: "HR Executive",
    level: 40,
    template: [
      ...EVERYONE,
      ["employee.view", "ALL"],
      ["employee.create", "ALL"],
      ["employee.edit", "ALL"],
      ...all(["attendance", "leave"], "ALL"),
      ["attendance.delete", null],
      ["leave.delete", null],
      ...each(ORG, "view", "ALL"),
    ],
  },
  {
    slug: "purchase-manager",
    name: "Purchase Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(PURCHASE, "ALL"),
      ...each(STOCK, "view", "ALL"),
      ["project.view", "ALL"],
    ],
  },
  {
    slug: "inventory-manager",
    name: "Inventory Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(STOCK, "ALL"),
      ["goods-receipt.*", "ALL"],
      ["purchase-order.view", "ALL"],
      ["project.view", "ALL"],
    ],
  },
  {
    slug: "project-manager",
    name: "Project Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(["project"], "ALL"),
      ["plot.view", "ALL"],
      ["plot.create", "ALL"],
      ["plot.edit", "ALL"],
      ["plot.block", "ALL"],
      ["plot.price", "ALL"],
      ...all(CONSTRUCTION, "ALL"),
      ["purchase-request.view", "ALL"],
      ["purchase-request.create", "ALL"],
      ["item.view", "ALL"],
      ["stock-movement.view", "ALL"],
    ],
  },
  {
    slug: "legal-officer",
    name: "Legal Officer",
    level: 40,
    template: [
      ...EVERYONE,
      ...all(["document", "legal-case"], "ALL"),
      ["customer.view", "ALL"],
      ["booking.view", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
    ],
  },
  {
    slug: "marketing-manager",
    name: "Marketing Manager",
    level: 60,
    template: [
      ...EVERYONE,
      ...all(["campaign", "lead-source", "creative", "landing-page"], "ALL"),
      ["lead.view", "ALL"],
      ["lead.create", "ALL"],
      ["lead.export", "ALL"],
      ["site-visit.view", "ALL"],
      ["booking.view", "ALL"],
      ["report.view", "ALL"],
      ...each(INVENTORY_VIEW, "view", "ALL"),
    ],
  },
  {
    slug: "auditor",
    name: "Auditor",
    level: 20,
    require2FA: true,
    description: "Read-only access to everything, including the audit log.",
    template: [...EVERYONE, ["*.view", "ALL"], ["*.export", "ALL"], ["*.print", "ALL"]],
  },
  {
    slug: "viewer",
    name: "Viewer",
    level: 10,
    description: "Dashboard only.",
    template: [...EVERYONE],
  },
];

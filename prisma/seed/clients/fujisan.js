/** Client-specific seed data for Fujisan Properties Ltd. (blueprint §2). */
export default {
  company: {
    name: "Fujisan Properties Ltd.",
    legalName: "Fujisan Properties Ltd.",
    currency: "BDT",
    timezone: "Asia/Dhaka",
    fiscalYearStartMonth: 7,
  },
  branches: [{ code: "HO", name: "Head Office", isHeadOffice: true }],
  departments: [
    { code: "SALES", name: "Sales" },
    { code: "CRM", name: "CRM" },
    { code: "MKT", name: "Marketing" },
    { code: "ACC", name: "Accounts & Finance" },
    { code: "HR", name: "HR & Admin" },
    { code: "PUR", name: "Purchase" },
    { code: "INV", name: "Inventory" },
    { code: "PRJ", name: "Project" },
    { code: "LEGAL", name: "Legal" },
    { code: "IT", name: "IT" },
  ],
  /** Lead sources (blueprint §5). Created once; renamed or switched off in the app. */
  leadSources: [
    "Facebook",
    "Website",
    "Google",
    "Phone",
    "WhatsApp",
    "Walk-in",
    "Referral",
    "Campaign",
    "Existing Customer",
  ],
  /**
   * Default approval chains, applied when the module that declares the process is first enabled.
   * Editable later in the app. DISCOUNT limits are an example until the client confirms them
   * (docs/01-requirements-analysis.md §5, question 7).
   */
  approvalChains: {
    DISCOUNT: [
      { name: "Team Leader", approverType: "TEAM_LEADER", maxPercent: 2 },
      { name: "Sales Manager", approverType: "ROLE", role: "sales-manager", maxPercent: 5 },
      { name: "Director", approverType: "ROLE", role: "director" },
    ],
    BOOKING: [{ name: "Sales Manager", approverType: "ROLE", role: "sales-manager" }],
  },
};

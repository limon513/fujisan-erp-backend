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
   * Editable later in the app. Bookings: the Sales Manager approves and settles the discount
   * (may change it); management sees every request without having to approve (client, 2026-10-24).
   */
  approvalChains: {
    BOOKING: [{ name: "Sales Manager", approverType: "ROLE", role: "sales-manager" }],
  },
};

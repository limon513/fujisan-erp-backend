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
};

/** Cost categories and the land inventory account (system key) each is capitalised into. */
export const CATEGORIES = {
  LAND_PURCHASE: { label: "Land purchase", account: "LAND_COST" },
  LAND_REGISTRATION: { label: "Land registration and mutation", account: "LAND_COST" },
  DEVELOPMENT: {
    label: "Development (earth filling, roads, drainage …)",
    account: "DEVELOPMENT_COST",
  },
  OTHER: { label: "Other project cost", account: "DEVELOPMENT_COST" },
};

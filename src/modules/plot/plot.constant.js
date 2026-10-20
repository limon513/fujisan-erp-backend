export const PLOT_STATUSES = ["AVAILABLE", "HOLD", "BOOKED", "SOLD", "BLOCKED"];

export const FACINGS = [
  "NORTH",
  "SOUTH",
  "EAST",
  "WEST",
  "NORTH_EAST",
  "NORTH_WEST",
  "SOUTH_EAST",
  "SOUTH_WEST",
];

/** Plots in these states are committed to a customer: no structural or price changes. */
export const LOCKED_STATUSES = ["BOOKED", "SOLD"];

export const sortableFields = ["code", "price", "areaSqft", "status", "createdAt"];

const actor = { select: { id: true, username: true, employee: { select: { fullName: true } } } };

export const plotListSelect = {
  id: true,
  code: true,
  plotNumber: true,
  areaSqft: true,
  dimensions: true,
  facing: true,
  price: true,
  status: true,
  statusChangedAt: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true, defaultHoldDays: true } },
  block: { select: { id: true, code: true, name: true } },
  road: { select: { id: true, name: true } },
  holds: {
    where: { status: "ACTIVE" },
    take: 1,
    select: {
      id: true,
      expiresAt: true,
      reason: true,
      requestedBy: { select: { id: true, fullName: true } },
      heldBy: actor,
    },
  },
};

export const plotDetailSelect = {
  ...plotListSelect,
  mapShape: true,
  mapLabel: true,
  statusHistory: { orderBy: { createdAt: "desc" }, take: 50 },
  priceHistory: { orderBy: { createdAt: "desc" }, take: 50 },
};

/** Flattens the active hold and adds rate per sqft (price ÷ area). */
export const toPlotDto = ({ holds, ...plot }) => ({
  ...plot,
  ratePerSqft:
    Number(plot.areaSqft) > 0 ? (Number(plot.price) / Number(plot.areaSqft)).toFixed(2) : null,
  activeHold: holds?.[0] ?? null,
});

/** Columns of the import file (first row = headers, case-insensitive). */
export const IMPORT_COLUMNS = {
  block: { required: true, aliases: ["block", "block code"] },
  plotNumber: { required: true, aliases: ["plot", "plot no", "plot number", "plotnumber"] },
  areaSqft: { required: true, aliases: ["area", "area sqft", "area (sqft)", "sqft", "size"] },
  price: { required: true, aliases: ["price", "price (bdt)", "price bdt"] },
  road: { required: false, aliases: ["road"] },
  facing: { required: false, aliases: ["facing"] },
  dimensions: { required: false, aliases: ["dimensions", "dimension"] },
  remarks: { required: false, aliases: ["remarks", "note", "notes"] },
};

export const MAX_IMPORT_ROWS = 2000;

/** Every hold the plot ever had (newest first). */
export const holdHistoryQuery = {
  orderBy: { createdAt: "desc" },
  take: 50,
  select: {
    id: true,
    status: true,
    reason: true,
    days: true,
    expiresAt: true,
    createdAt: true,
    releasedAt: true,
    releaseReason: true,
    prospectName: true,
    prospectMobile: true,
    requestedBy: { select: { id: true, fullName: true } },
    heldBy: actor,
    releasedBy: actor,
  },
};

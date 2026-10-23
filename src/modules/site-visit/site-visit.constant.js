export const TRANSPORTS = ["OFFICE_CAR", "OWN", "OTHER"];
export const TRANSPORT_LABELS = { OFFICE_CAR: "office car", OWN: "own transport", OTHER: "other" };
export const INTEREST_LEVELS = ["HOT", "WARM", "COLD"];
export const VISIT_STATUSES = ["SCHEDULED", "VISITED", "NO_SHOW", "CANCELLED"];
export const WHEN = ["today", "upcoming", "missed", "open", "past", "all"];

/** The employee going along is reminded this long before the visit. */
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

export const sortableFields = ["scheduledAt", "createdAt"];

export const siteVisitSelect = {
  id: true,
  scheduledAt: true,
  transport: true,
  pickupPoint: true,
  visitors: true,
  note: true,
  status: true,
  visitedAt: true,
  interest: true,
  plotsShown: true,
  feedback: true,
  cancelReason: true,
  createdAt: true,
  lead: {
    select: { id: true, leadCode: true, fullName: true, mobile: true, status: true },
  },
  project: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
};

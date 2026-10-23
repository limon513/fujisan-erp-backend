export const LEAD_SEQUENCE = { key: "LEAD", prefix: "LD-", padding: 6 };

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "FOLLOW_UP",
  "SITE_VISIT",
  "NEGOTIATION",
  "BOOKING",
  "CONVERTED",
  "LOST",
];
/** Statuses a lead is still being worked in. */
export const OPEN_STATUSES = LEAD_STATUSES.filter((s) => s !== "CONVERTED" && s !== "LOST");

/** Activities a person logs by hand. The rest are written by the system. */
export const MANUAL_ACTIVITIES = ["NOTE", "CALL", "SMS", "WHATSAPP", "EMAIL", "MEETING"];
/** Logging one of these on a NEW lead moves it to CONTACTED. */
export const CONTACT_ACTIVITIES = ["CALL", "SMS", "WHATSAPP", "EMAIL", "MEETING"];

export const searchableFields = ["fullName", "leadCode", "mobile", "email", "location"];
export const sortableFields = [
  "createdAt",
  "fullName",
  "nextFollowUpAt",
  "lastActivityAt",
  "status",
];

const person = { select: { id: true, fullName: true, employeeCode: true } };

export const leadListSelect = {
  id: true,
  leadCode: true,
  fullName: true,
  mobile: true,
  email: true,
  location: true,
  status: true,
  budgetMin: true,
  budgetMax: true,
  nextFollowUpAt: true,
  lastActivityAt: true,
  createdAt: true,
  source: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  preferredProject: { select: { id: true, name: true } },
  owner: { select: { ...person.select, team: { select: { id: true, name: true } } } },
};

export const leadDetailSelect = {
  ...leadListSelect,
  altMobile: true,
  profession: true,
  propertyType: true,
  notes: true,
  lostReason: true,
  externalRef: true,
  assignedAt: true,
  convertedAt: true,
  updatedAt: true,
  duplicateOf: { select: { id: true, leadCode: true, fullName: true, status: true } },
  convertedCustomer: { select: { id: true, customerCode: true, fullName: true } },
  _count: { select: { duplicates: { where: { deletedAt: null } } } },
};

export const FOLLOW_UP_TYPES = ["CALL", "WHATSAPP", "SMS", "EMAIL", "MEETING"];
export const TYPE_LABELS = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
  MEETING: "Meeting",
};
export const WHEN = ["overdue", "today", "upcoming", "open", "done", "cancelled", "all"];

/** Reminder goes out this long before a follow-up is due. */
export const REMINDER_LEAD_MS = 15 * 60 * 1000;

export const sortableFields = ["dueAt", "createdAt", "doneAt"];

export const followUpSelect = {
  id: true,
  type: true,
  dueAt: true,
  purpose: true,
  status: true,
  outcome: true,
  doneAt: true,
  cancelReason: true,
  createdAt: true,
  lead: {
    select: { id: true, leadCode: true, fullName: true, mobile: true, status: true },
  },
  owner: { select: { id: true, fullName: true } },
  doneBy: { select: { id: true, username: true, employee: { select: { fullName: true } } } },
};

import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildScopeWhere } from "#core/rbac/scope.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import logger from "#core/utils/logger.js";
import { dhakaDay, formatDhaka } from "#core/utils/time.js";
import { findLeadForWork, resolveWorkOwner } from "#modules/lead/lead.access.js";
import {
  leadStamp,
  logActivity,
  markContacted,
  notifyEmployee,
  refreshNextFollowUp,
} from "#modules/lead/lead.workflow.js";
import { followUpSelect, REMINDER_LEAD_MS, TYPE_LABELS } from "./follow-up.constant.js";

const userName = (user) => user?.employee?.fullName ?? user?.username ?? null;

const toDto = ({ doneBy, ...followUp }) => ({
  ...followUp,
  doneBy: doneBy ? { id: doneBy.id, name: userName(doneBy) } : null,
});

/** Where-clause for a due bucket, in Dhaka days. */
function whenWhere(when, now = new Date()) {
  const { start, end } = dhakaDay(now);
  switch (when) {
    case "overdue":
      return { status: "PENDING", dueAt: { lt: now } };
    case "today":
      return { status: "PENDING", dueAt: { gte: now, lt: end } };
    case "upcoming":
      return { status: "PENDING", dueAt: { gte: end } };
    case "open":
      return { status: "PENDING" };
    case "done":
      return { status: "DONE", doneAt: { gte: new Date(start.getTime() - 30 * 86_400_000) } };
    case "cancelled":
      return { status: "CANCELLED" };
    default:
      return {};
  }
}

const baseWhere = ({ actor, scope }, query) => ({
  AND: [
    buildScopeWhere(actor, scope),
    { lead: { deletedAt: null } },
    // Users without an employee record have nothing assigned to them
    query.mine ? (actor.employeeId ? { ownerId: actor.employeeId } : { id: { in: [] } }) : {},
    query.leadId ? { leadId: query.leadId } : {},
    query.ownerId ? { ownerId: query.ownerId } : {},
  ],
});

const findFollowUp = async (access, id) => {
  const followUp = await prisma.followUp.findFirst({
    where: { id, AND: [buildScopeWhere(access.actor, access.scope)] },
    select: { ...followUpSelect, leadId: true, ownerId: true },
  });
  if (!followUp) throw AppError.notFound("Follow-up not found");
  return followUp;
};

const assertPending = (followUp) => {
  if (followUp.status !== "PENDING") {
    throw AppError.conflict(`This follow-up is already ${followUp.status.toLowerCase()}`);
  }
};

const scheduledText = ({ type, dueAt, purpose }) =>
  `${TYPE_LABELS[type]} on ${formatDhaka(dueAt)}${purpose ? `: ${purpose}` : ""}`;

// ---- Queries --------------------------------------------------------------------------------

const list = async (access, query) => {
  const where = { AND: [baseWhere(access, query), whenWhere(query.when)] };
  const orderBy = query.when === "done" ? { doneAt: "desc" } : { dueAt: "asc" };
  const [rows, total] = await prisma.$transaction([
    prisma.followUp.findMany({
      where,
      orderBy: [orderBy, { createdAt: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: followUpSelect,
    }),
    prisma.followUp.count({ where }),
  ]);
  return { data: rows.map(toDto), meta: paginationMeta(query, total) };
};

/** Overdue / due today / later, for tabs and the dashboard. */
const counts = async (access, query) => {
  const base = baseWhere(access, query);
  const [overdue, today, upcoming] = await Promise.all(
    ["overdue", "today", "upcoming"].map((when) =>
      prisma.followUp.count({ where: { AND: [base, whenWhere(when)] } }),
    ),
  );
  return { overdue, today, upcoming };
};

const getById = async (access, id) => {
  const { leadId: _leadId, ownerId: _ownerId, ...followUp } = await findFollowUp(access, id);
  return toDto(followUp);
};

// ---- Commands -------------------------------------------------------------------------------

async function schedule(tx, actor, lead, stamp, { type, dueAt, purpose }) {
  const created = await tx.followUp.create({
    data: { leadId: lead.id, type, dueAt, purpose, ...stamp, createdById: actor.userId },
  });
  await logActivity(tx, lead.id, actor, {
    type: "FOLLOW_UP_SCHEDULED",
    body: scheduledText(created),
  });
  await refreshNextFollowUp(tx, lead.id);
  await notifyEmployee(tx, actor, stamp.ownerId, {
    type: "FOLLOW_UP_ASSIGNED",
    title: `Follow-up: ${lead.fullName}`,
    body: scheduledText(created),
    link: `/crm/leads/${lead.id}`,
  });
  return created;
}

const create = async (access, { leadId, ownerId, ...data }) => {
  const lead = await findLeadForWork(access, leadId);
  const stamp = await resolveWorkOwner(access, lead, ownerId);
  const created = await prisma.$transaction((tx) => schedule(tx, access.actor, lead, stamp, data));
  return getById({ ...access, scope: "ALL" }, created.id);
};

const update = async (access, id, { ownerId, ...data }) => {
  const followUp = await findFollowUp(access, id);
  assertPending(followUp);
  const lead = await findLeadForWork(access, followUp.leadId);
  const stamp = ownerId !== undefined ? await resolveWorkOwner(access, lead, ownerId) : {};

  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id },
      // A new time deserves a new reminder
      data: {
        ...data,
        ...stamp,
        ...(data.dueAt && { reminderSentAt: null }),
        updatedById: access.actor.userId,
      },
    });
    await refreshNextFollowUp(tx, lead.id);
  });
  return getById({ ...access, scope: "ALL" }, id);
};

/** Records what happened (on the lead's timeline) and optionally schedules the next one. */
const complete = async (access, id, { outcome, next }) => {
  const { actor } = access;
  const followUp = await findFollowUp(access, id);
  assertPending(followUp);
  const lead = await findLeadForWork(access, followUp.leadId);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.followUp.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "DONE", outcome, doneAt: new Date(), doneById: actor.userId },
    });
    if (!count) throw AppError.conflict("Someone else just completed this follow-up");
    await logActivity(tx, lead.id, actor, { type: followUp.type, body: outcome });
    await markContacted(tx, lead.id, followUp.type);
    if (next) {
      await schedule(tx, actor, lead, leadStamp(lead), next);
    }
    await refreshNextFollowUp(tx, lead.id);
  });
  return getById({ ...access, scope: "ALL" }, id);
};

const cancel = async (access, id, { reason }) => {
  const followUp = await findFollowUp(access, id);
  assertPending(followUp);
  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason ?? null, updatedById: access.actor.userId },
    });
    await refreshNextFollowUp(tx, followUp.leadId);
  });
  return getById(access, id);
};

/**
 * Background job: reminds the assigned employee shortly before a follow-up is due. Each
 * follow-up is claimed with a conditional update, so parallel runs never remind twice.
 */
const sendReminders = async (now = new Date()) => {
  const due = await prisma.followUp.findMany({
    where: {
      status: "PENDING",
      reminderSentAt: null,
      ownerId: { not: null },
      dueAt: { lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
      lead: { deletedAt: null },
    },
    take: 200,
    select: {
      id: true,
      type: true,
      dueAt: true,
      purpose: true,
      ownerId: true,
      lead: { select: { id: true, fullName: true } },
    },
  });
  let sent = 0;
  for (const followUp of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.followUp.updateMany({
        where: { id: followUp.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!count) return;
      const overdue = followUp.dueAt < now;
      await notifyEmployee(tx, null, followUp.ownerId, {
        type: "FOLLOW_UP_DUE",
        title: `${overdue ? "Overdue" : "Due soon"}: ${TYPE_LABELS[followUp.type]} ${followUp.lead.fullName}`,
        body: `${formatDhaka(followUp.dueAt)}${followUp.purpose ? ` · ${followUp.purpose}` : ""}`,
        link: `/crm/leads/${followUp.lead.id}`,
      });
      sent += 1;
    });
  }
  if (sent) logger.info({ sent }, "Follow-up reminders sent");
  return sent;
};

export const FollowUpService = {
  list,
  counts,
  getById,
  create,
  update,
  complete,
  cancel,
  sendReminders,
};

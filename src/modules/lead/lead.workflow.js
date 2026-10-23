import { CONTACT_ACTIVITIES, LEAD_STATUSES } from "./lead.constant.js";

/**
 * Lead bookkeeping shared by leads, follow-ups and site visits. All take a transaction client.
 */

/** Appends to the lead's timeline and marks it as worked now. actor null = system. */
export async function logActivity(tx, leadId, actor, activity) {
  await tx.leadActivity.create({
    data: { leadId, createdById: actor?.userId ?? null, ...activity },
  });
  await tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: new Date() } });
}

/**
 * Moves a lead forward to `target` if it is earlier in the pipeline (never backwards, never out of
 * CONVERTED/LOST). Returns true when it moved.
 */
export async function advanceStatus(tx, leadId, target, reason) {
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
  const from = LEAD_STATUSES.indexOf(lead.status);
  if (["CONVERTED", "LOST"].includes(lead.status) || from >= LEAD_STATUSES.indexOf(target)) {
    return false;
  }
  await tx.lead.update({ where: { id: leadId }, data: { status: target } });
  await logActivity(tx, leadId, null, {
    type: "STATUS_CHANGE",
    fromStatus: lead.status,
    toStatus: target,
    body: reason,
  });
  return true;
}

/** A call/message/meeting on a NEW lead moves it to CONTACTED. */
export const markContacted = (tx, leadId, activityType) =>
  CONTACT_ACTIVITIES.includes(activityType)
    ? advanceStatus(tx, leadId, "CONTACTED", "First contact logged")
    : false;

/** lead.nextFollowUpAt = earliest pending follow-up (null when none). */
export async function refreshNextFollowUp(tx, leadId) {
  const next = await tx.followUp.findFirst({
    where: { leadId, status: "PENDING" },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

/** Sends an in-app notification to an employee's user account(s), unless they did it themselves. */
export async function notifyEmployee(tx, actor, employeeId, { type, title, body, link }) {
  if (!employeeId || employeeId === actor?.employeeId) return;
  const users = await tx.user.findMany({
    where: { employeeId, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!users.length) return;
  await tx.notification.createMany({
    data: users.map((user) => ({ userId: user.id, type, title, body, link })),
  });
}

/** Org stamp copied from the lead onto its follow-ups / visits, so they share its data scope. */
export const leadStamp = (lead) => ({
  ownerId: lead.ownerId,
  teamId: lead.teamId,
  departmentId: lead.departmentId,
  branchId: lead.branchId,
});

/** When a lead changes hands, its open follow-ups and visits go with it. */
export async function moveOpenWork(tx, leadId, stamp) {
  await tx.followUp.updateMany({ where: { leadId, status: "PENDING" }, data: stamp });
  await tx.siteVisit.updateMany({ where: { leadId, status: "SCHEDULED" }, data: stamp });
}

/** A lost or deleted lead needs no more follow-ups or visits. */
export async function cancelOpenWork(tx, leadId, reason) {
  await tx.followUp.updateMany({
    where: { leadId, status: "PENDING" },
    data: { status: "CANCELLED", cancelReason: reason },
  });
  await tx.siteVisit.updateMany({
    where: { leadId, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelReason: reason },
  });
  await refreshNextFollowUp(tx, leadId);
}

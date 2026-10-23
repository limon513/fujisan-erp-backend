import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildScopeWhere } from "#core/rbac/scope.js";
import { paginationMeta } from "#core/utils/listQuery.js";
import logger from "#core/utils/logger.js";
import { dhakaDay, formatDhaka } from "#core/utils/time.js";
import { findLeadForWork, resolveWorkOwner } from "#modules/lead/lead.access.js";
import { advanceStatus, logActivity, notifyEmployee } from "#modules/lead/lead.workflow.js";
import { REMINDER_LEAD_MS, siteVisitSelect, TRANSPORT_LABELS } from "./site-visit.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/** Where-clause for a bucket, in Dhaka days. */
function whenWhere(when, now = new Date()) {
  const { start, end } = dhakaDay(now);
  switch (when) {
    case "today":
      return { status: "SCHEDULED", scheduledAt: { gte: start, lt: end } };
    case "upcoming":
      return { status: "SCHEDULED", scheduledAt: { gte: end } };
    // scheduled before today and never marked as visited / no-show
    case "missed":
      return { status: "SCHEDULED", scheduledAt: { lt: start } };
    case "open":
      return { status: "SCHEDULED" };
    case "past":
      return { status: { in: ["VISITED", "NO_SHOW", "CANCELLED"] } };
    default:
      return {};
  }
}

const baseWhere = ({ actor, scope }, query) => ({
  AND: [
    buildScopeWhere(actor, scope),
    { lead: { deletedAt: null } },
    query.mine ? (actor.employeeId ? { ownerId: actor.employeeId } : { id: { in: [] } }) : {},
    query.leadId ? { leadId: query.leadId } : {},
    query.ownerId ? { ownerId: query.ownerId } : {},
    query.projectId ? { projectId: query.projectId } : {},
    query.status ? { status: query.status } : {},
  ],
});

const findVisit = async (access, id) => {
  const visit = await prisma.siteVisit.findFirst({
    where: { id, AND: [buildScopeWhere(access.actor, access.scope)] },
    select: { ...siteVisitSelect, leadId: true },
  });
  if (!visit) throw AppError.notFound("Site visit not found");
  return visit;
};

const assertScheduled = (visit) => {
  if (visit.status !== "SCHEDULED") {
    throw AppError.conflict(
      `This visit is already ${visit.status.toLowerCase().replace("_", "-")}`,
    );
  }
};

async function assertProject(projectId) {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!project) throw invalid("projectId", "Project not found");
  return project;
}

const visitText = (visit, projectName) =>
  `${projectName} on ${formatDhaka(visit.scheduledAt)}, ${TRANSPORT_LABELS[visit.transport]}` +
  (visit.pickupPoint ? ` from ${visit.pickupPoint}` : "");

// ---- Queries --------------------------------------------------------------------------------

const list = async (access, query) => {
  const where = { AND: [baseWhere(access, query), whenWhere(query.when)] };
  const orderBy = query.when === "past" ? { scheduledAt: "desc" } : { scheduledAt: "asc" };
  const [data, total] = await prisma.$transaction([
    prisma.siteVisit.findMany({
      where,
      orderBy: [orderBy, { createdAt: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: siteVisitSelect,
    }),
    prisma.siteVisit.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

/** Visits today / later / missed (never closed), for tabs and the dashboard. */
const counts = async (access, query) => {
  const base = baseWhere(access, query);
  const [today, upcoming, missed] = await Promise.all(
    ["today", "upcoming", "missed"].map((when) =>
      prisma.siteVisit.count({ where: { AND: [base, whenWhere(when)] } }),
    ),
  );
  return { today, upcoming, missed };
};

const getById = async (access, id) => {
  const { leadId: _leadId, ...visit } = await findVisit(access, id);
  return visit;
};

// ---- Commands -------------------------------------------------------------------------------

/** Books a visit; the lead moves on to SITE_VISIT and the employee going along is notified. */
const create = async (access, { leadId, ownerId, ...data }) => {
  const { actor } = access;
  const lead = await findLeadForWork(access, leadId);
  const project = await assertProject(data.projectId);
  const stamp = await resolveWorkOwner(access, lead, ownerId);

  const visit = await prisma.$transaction(async (tx) => {
    const created = await tx.siteVisit.create({
      data: { leadId, ...data, ...stamp, createdById: actor.userId },
    });
    await logActivity(tx, leadId, actor, {
      type: "SITE_VISIT_SCHEDULED",
      body: visitText(created, project.name),
    });
    await advanceStatus(tx, leadId, "SITE_VISIT", "Site visit scheduled");
    await notifyEmployee(tx, actor, stamp.ownerId, {
      type: "SITE_VISIT_ASSIGNED",
      title: `Site visit: ${lead.fullName}`,
      body: visitText(created, project.name),
      link: `/crm/leads/${leadId}`,
    });
    return created;
  });
  return getById({ ...access, scope: "ALL" }, visit.id);
};

const update = async (access, id, { ownerId, ...data }) => {
  const visit = await findVisit(access, id);
  assertScheduled(visit);
  await assertProject(data.projectId);
  const lead = await findLeadForWork(access, visit.leadId);
  const stamp = ownerId !== undefined ? await resolveWorkOwner(access, lead, ownerId) : {};
  await prisma.siteVisit.update({
    where: { id },
    data: {
      ...data,
      ...stamp,
      ...(data.scheduledAt && { reminderSentAt: null }),
      updatedById: access.actor.userId,
    },
  });
  return getById({ ...access, scope: "ALL" }, id);
};

/** Visited (with interest level, plots shown, feedback) or no-show; logged on the lead. */
const complete = async (access, id, { status, visitedAt, interest, plotsShown, feedback }) => {
  const { actor } = access;
  const visit = await findVisit(access, id);
  assertScheduled(visit);
  const when = visitedAt ?? new Date();
  if (status === "VISITED" && when > new Date()) {
    throw invalid("visitedAt", "A visit can't be recorded in the future");
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.siteVisit.updateMany({
      where: { id, status: "SCHEDULED" },
      data: {
        status,
        visitedAt: status === "VISITED" ? when : null,
        interest: status === "VISITED" ? interest : null,
        plotsShown,
        feedback,
        completedById: actor.userId,
        updatedById: actor.userId,
      },
    });
    if (!count) throw AppError.conflict("Someone else just closed this visit");
    const summary =
      status === "VISITED"
        ? [
            `Visited ${visit.project.name}`,
            `interest ${interest.toLowerCase()}`,
            plotsShown && `shown ${plotsShown}`,
          ]
            .filter(Boolean)
            .join(", ")
        : `Didn't come to ${visit.project.name}`;
    await logActivity(tx, visit.leadId, actor, {
      type: "SITE_VISIT",
      body: feedback ? `${summary}. ${feedback}` : summary,
      data: { siteVisitId: id, status, interest: interest ?? null },
    });
  });
  return getById({ ...access, scope: "ALL" }, id);
};

const cancel = async (access, id, { reason }) => {
  const visit = await findVisit(access, id);
  assertScheduled(visit);
  await prisma.$transaction(async (tx) => {
    await tx.siteVisit.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason ?? null, updatedById: access.actor.userId },
    });
    await logActivity(tx, visit.leadId, access.actor, {
      type: "NOTE",
      body: `Site visit on ${formatDhaka(visit.scheduledAt)} cancelled${reason ? `: ${reason}` : ""}`,
    });
  });
  return getById(access, id);
};

/** Background job: reminds the employee going along a couple of hours before the visit. */
const sendReminders = async (now = new Date()) => {
  const due = await prisma.siteVisit.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      ownerId: { not: null },
      scheduledAt: { gte: now, lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
      lead: { deletedAt: null },
    },
    take: 200,
    select: {
      id: true,
      scheduledAt: true,
      transport: true,
      pickupPoint: true,
      ownerId: true,
      project: { select: { name: true } },
      lead: { select: { id: true, fullName: true } },
    },
  });
  let sent = 0;
  for (const visit of due) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.siteVisit.updateMany({
        where: { id: visit.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!count) return;
      await notifyEmployee(tx, null, visit.ownerId, {
        type: "SITE_VISIT_DUE",
        title: `Site visit soon: ${visit.lead.fullName}`,
        body: visitText(visit, visit.project.name),
        link: `/crm/leads/${visit.lead.id}`,
      });
      sent += 1;
    });
  }
  if (sent) logger.info({ sent }, "Site visit reminders sent");
  return sent;
};

export const SiteVisitService = {
  list,
  counts,
  getById,
  create,
  update,
  complete,
  cancel,
  sendReminders,
};

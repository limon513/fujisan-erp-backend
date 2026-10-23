import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { nextCode } from "#core/numbering/sequence.js";
import { assertInScope, buildScopeWhere } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  LEAD_SEQUENCE,
  leadDetailSelect,
  leadListSelect,
  OPEN_STATUSES,
  searchableFields,
} from "./lead.constant.js";
import {
  cancelOpenWork,
  leadStamp,
  logActivity,
  markContacted,
  moveOpenWork,
  notifyEmployee,
  refreshNextFollowUp,
} from "./lead.workflow.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope);

const findLead = async (access, id, select = leadDetailSelect) => {
  const lead = await prisma.lead.findFirst({
    where: { id, deletedAt: null, AND: [scopeWhere(access)] },
    select,
  });
  if (!lead) throw AppError.notFound("Lead not found");
  return lead;
};

/** Scope the actor has for assigning leads to others (null = may not). */
const assignScope = (actor) =>
  actor.isSuperAdmin ? "ALL" : (actor.permissions["lead.assign"] ?? null);

async function loadOwner(ownerId) {
  const owner = await prisma.employee.findFirst({
    where: { id: ownerId, deletedAt: null, employmentStatus: "ACTIVE" },
    select: { id: true, fullName: true, teamId: true, departmentId: true, branchId: true },
  });
  if (!owner) throw invalid("ownerId", "Choose an active employee");
  return owner;
}

const ownerStamp = (owner) => ({
  ownerId: owner.id,
  teamId: owner.teamId,
  departmentId: owner.departmentId,
  branchId: owner.branchId,
});

/** Unassigned leads stay visible to managers of the creator's branch/department. */
const poolStamp = (actor) => ({
  ownerId: null,
  teamId: null,
  departmentId: actor.departmentId,
  branchId: actor.branchId,
});

/** Owner + org stamp for a new lead. */
async function resolveOwnership(actor, { ownerId, unassigned }) {
  const scope = assignScope(actor);
  if (unassigned) {
    if (!scope) throw AppError.forbidden("You can't leave a lead unassigned");
    return { ...poolStamp(actor), assignedAt: null };
  }
  if (!ownerId || ownerId === actor.employeeId) {
    if (!actor.employeeId) return { ...poolStamp(actor), assignedAt: null };
    const self = await loadOwner(actor.employeeId);
    return { ...ownerStamp(self), assignedAt: new Date() };
  }
  if (!scope) throw AppError.forbidden("You can only add leads for yourself");
  const owner = await loadOwner(ownerId);
  assertInScope(actor, scope, ownerStamp(owner));
  return { ...ownerStamp(owner), assignedAt: new Date() };
}

// ---- Duplicates -----------------------------------------------------------------------------

/**
 * Leads and customers sharing a mobile (main or alternative) or email, across all scopes, so the
 * same person isn't worked twice. Minimal details only.
 */
async function findDuplicates({ mobile, altMobile, email, excludeId }) {
  const mobiles = [mobile, altMobile].filter(Boolean);
  const or = [
    ...(mobiles.length ? [{ mobile: { in: mobiles } }, { altMobile: { in: mobiles } }] : []),
    ...(email ? [{ email }] : []),
  ];
  if (!or.length) return { leads: [], customers: [] };

  const matchedOn = (row) => [
    ...(mobiles.some((m) => m === row.mobile || m === row.altMobile) ? ["mobile"] : []),
    ...(email && row.email === email ? ["email"] : []),
  ];
  const [leads, customers] = await Promise.all([
    prisma.lead.findMany({
      where: { deletedAt: null, OR: or, ...(excludeId && { id: { not: excludeId } }) },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        leadCode: true,
        fullName: true,
        status: true,
        mobile: true,
        altMobile: true,
        email: true,
        createdAt: true,
        owner: { select: { fullName: true } },
      },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, OR: or },
      take: 5,
      select: {
        id: true,
        customerCode: true,
        fullName: true,
        mobile: true,
        altMobile: true,
        email: true,
        owner: { select: { fullName: true } },
      },
    }),
  ]);
  return {
    leads: leads.map((row) => ({
      id: row.id,
      leadCode: row.leadCode,
      fullName: row.fullName,
      status: row.status,
      createdAt: row.createdAt,
      ownerName: row.owner?.fullName ?? null,
      matchedOn: matchedOn(row),
    })),
    customers: customers.map((row) => ({
      id: row.id,
      customerCode: row.customerCode,
      fullName: row.fullName,
      ownerName: row.owner?.fullName ?? null,
      matchedOn: matchedOn(row),
    })),
  };
}

const describe = (lead) =>
  `${lead.leadCode} ${lead.fullName}${lead.ownerName ? ` (with ${lead.ownerName})` : " (unassigned)"}`;

/**
 * Refuses a lead whose mobile/email another lead already has, unless confirmed. Returns the lead it
 * duplicates (an open one first), to link them.
 */
async function checkDuplicate(values, confirmDuplicate) {
  const { leads } = await findDuplicates(values);
  if (!leads.length) return null;
  const original = leads.find((l) => OPEN_STATUSES.includes(l.status)) ?? leads[0];
  if (!confirmDuplicate) {
    const path = original.matchedOn.includes("mobile") ? "mobile" : "email";
    throw AppError.conflict(`This person is already a lead: ${describe(original)}`, [
      { path, message: `Already a lead: ${describe(original)}. Confirm to add anyway.` },
    ]);
  }
  return original;
}

// ---- References -----------------------------------------------------------------------------

async function assertReferences({ sourceId, campaignId, preferredProjectId }) {
  const [source, campaign, project] = await Promise.all([
    sourceId ? prisma.leadSource.findUnique({ where: { id: sourceId } }) : null,
    campaignId ? prisma.campaign.findFirst({ where: { id: campaignId, deletedAt: null } }) : null,
    preferredProjectId
      ? prisma.project.findFirst({ where: { id: preferredProjectId, deletedAt: null } })
      : null,
  ]);
  if (sourceId && !source) throw invalid("sourceId", "Source not found");
  if (source && !source.isActive) throw invalid("sourceId", "This source is switched off");
  if (campaignId && !campaign) throw invalid("campaignId", "Campaign not found");
  if (preferredProjectId && !project) throw invalid("preferredProjectId", "Project not found");
}

// ---- Activities and notifications -----------------------------------------------------------

/** Tells the newly assigned employee (unless they assigned it to themselves). */
const notifyOwner = (tx, actor, lead) =>
  notifyEmployee(tx, actor, lead.ownerId, {
    type: "LEAD_ASSIGNED",
    title: `New lead: ${lead.fullName}`,
    body: lead.leadCode,
    link: `/crm/leads/${lead.id}`,
  });

const userName = (user) => user?.employee?.fullName ?? user?.username ?? null;

const toDetailDto = ({ _count, ...lead }, activities) => ({
  ...lead,
  duplicateCount: _count.duplicates,
  activities: activities.map(({ createdBy, ...activity }) => ({
    ...activity,
    createdBy: createdBy ? { id: createdBy.id, name: userName(createdBy) } : null,
  })),
});

// ---- Queries --------------------------------------------------------------------------------

const NULLS_LAST = ["nextFollowUpAt", "lastActivityAt"];

const ownerName = { select: { id: true, fullName: true } };
const openFollowUpSelect = {
  id: true,
  type: true,
  dueAt: true,
  purpose: true,
  owner: ownerName,
};
const openVisitSelect = {
  id: true,
  scheduledAt: true,
  transport: true,
  pickupPoint: true,
  visitors: true,
  note: true,
  project: { select: { id: true, name: true } },
  owner: ownerName,
};

const list = async (access, query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    deletedAt: null,
    AND: [
      scopeWhere(access),
      searchWhere,
      query.status === "OPEN"
        ? { status: { in: OPEN_STATUSES } }
        : query.status
          ? { status: query.status }
          : {},
      query.sourceId ? { sourceId: query.sourceId } : {},
      query.campaignId ? { campaignId: query.campaignId } : {},
      query.projectId ? { preferredProjectId: query.projectId } : {},
      query.ownerId ? { ownerId: query.ownerId } : {},
      query.unassigned ? { ownerId: null } : {},
    ],
  };
  const order = NULLS_LAST.includes(query.sortBy)
    ? { [query.sortBy]: { sort: query.sortOrder, nulls: "last" } }
    : orderBy;
  const [data, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      skip,
      take,
      orderBy: [order, { createdAt: "desc" }],
      select: leadListSelect,
    }),
    prisma.lead.count({ where }),
  ]);
  return { data, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => {
  const lead = await findLead(access, id);
  const [followUps, siteVisits] = await Promise.all([
    prisma.followUp.findMany({
      where: { leadId: id, status: "PENDING" },
      orderBy: { dueAt: "asc" },
      select: openFollowUpSelect,
    }),
    prisma.siteVisit.findMany({
      where: { leadId: id, status: "SCHEDULED" },
      orderBy: { scheduledAt: "asc" },
      select: openVisitSelect,
    }),
  ]);
  const activities = await prisma.leadActivity.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      body: true,
      fromStatus: true,
      toStatus: true,
      data: true,
      createdAt: true,
      createdBy: { select: { id: true, username: true, employee: { select: { fullName: true } } } },
    },
  });
  return { ...toDetailDto(lead, activities), followUps, siteVisits };
};

const checkDuplicates = (query) => findDuplicates(query);

/** Active employees the actor may assign leads to (their lead.assign scope). */
const assignees = async (access) =>
  prisma.employee.findMany({
    where: {
      deletedAt: null,
      employmentStatus: "ACTIVE",
      AND: [buildScopeWhere(access.actor, access.scope, { owner: "id" })],
    },
    orderBy: { fullName: "asc" },
    take: 500,
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: { select: { name: true } },
      team: { select: { id: true, name: true } },
    },
  });

// ---- Commands -------------------------------------------------------------------------------

const create = async (
  access,
  { confirmDuplicate, ownerId, unassigned, nextFollowUpAt, ...data },
) => {
  const { actor } = access;
  await assertReferences(data);
  const original = await checkDuplicate(data, confirmDuplicate);
  const ownership = await resolveOwnership(actor, { ownerId, unassigned });

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        ...data,
        ...ownership,
        duplicateOfId: original?.id ?? null,
        leadCode: await nextCode(tx, LEAD_SEQUENCE),
        createdById: actor.userId,
      },
    });
    await logActivity(tx, created.id, actor, {
      type: "CREATED",
      body: original ? `Added again although ${describe(original)} exists` : null,
      toStatus: created.status,
    });
    if (nextFollowUpAt) {
      await tx.followUp.create({
        data: {
          leadId: created.id,
          type: "CALL",
          dueAt: nextFollowUpAt,
          purpose: "First follow-up",
          ...leadStamp(created),
          createdById: actor.userId,
        },
      });
      await refreshNextFollowUp(tx, created.id);
    }
    await notifyOwner(tx, actor, created);
    return created;
  });
  return getById({ actor, scope: "ALL" }, lead.id);
};

const update = async (access, id, { confirmDuplicate, ...data }) => {
  const current = await findLead(access, id, {
    id: true,
    mobile: true,
    altMobile: true,
    email: true,
    budgetMin: true,
    budgetMax: true,
  });
  await assertReferences(data);

  const changed = (field) => data[field] !== undefined && data[field] !== current[field];
  if (changed("mobile") || changed("altMobile") || changed("email")) {
    await checkDuplicate(
      {
        mobile: data.mobile ?? current.mobile,
        altMobile: data.altMobile !== undefined ? data.altMobile : current.altMobile,
        email: data.email !== undefined ? data.email : current.email,
        excludeId: id,
      },
      confirmDuplicate,
    );
  }
  const min = data.budgetMin !== undefined ? data.budgetMin : current.budgetMin;
  const max = data.budgetMax !== undefined ? data.budgetMax : current.budgetMax;
  if (min != null && max != null && Number(min) > Number(max)) {
    throw invalid("budgetMax", "Lower than the minimum");
  }

  await prisma.lead.update({
    where: { id },
    data: { ...data, updatedById: access.actor.userId },
  });
  return getById(access, id);
};

const remove = async (access, id) => {
  await findLead(access, id, { id: true });
  await prisma.$transaction(async (tx) => {
    await cancelOpenWork(tx, id, "Lead deleted");
    await tx.lead.update({
      where: { id },
      data: { deletedAt: new Date(), externalRef: null, updatedById: access.actor.userId },
    });
  });
};

/** Moves a lead along the pipeline. CONVERTED comes from `convert`; LOST needs a reason. */
const changeStatus = async (access, id, { status, lostReason, note }) => {
  const lead = await findLead(access, id, { id: true, status: true });
  if (lead.status === "CONVERTED") throw AppError.conflict("This lead is already a customer");
  if (lead.status === status) return getById(access, id);

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        status,
        lostReason: status === "LOST" ? lostReason : null,
        updatedById: access.actor.userId,
      },
    });
    await logActivity(tx, id, access.actor, {
      type: "STATUS_CHANGE",
      fromStatus: lead.status,
      toStatus: status,
      body: [status === "LOST" ? lostReason : null, note].filter(Boolean).join(" — ") || null,
    });
    if (status === "LOST") await cancelOpenWork(tx, id, "Lead lost");
  });
  return getById(access, id);
};

/** Logs a call, note, message or meeting. A first contact moves a NEW lead to CONTACTED. */
const addActivity = async (access, id, { type, body }) => {
  await findLead(access, id, { id: true });
  await prisma.$transaction(async (tx) => {
    await logActivity(tx, id, access.actor, { type, body });
    await markContacted(tx, id, type);
  });
  return getById(access, id);
};

/** Hands the lead to another employee (inside the assigner's scope), or back to the pool. */
const assign = async (access, id, { ownerId, note }) => {
  const { actor } = access;
  const lead = await findLead(access, id, {
    id: true,
    ownerId: true,
    status: true,
    owner: { select: { fullName: true } },
  });
  if (lead.ownerId === ownerId) return getById(access, id);
  if (lead.status === "CONVERTED") throw AppError.conflict("This lead is already a customer");

  let stamp;
  let ownerName = null;
  if (ownerId) {
    const owner = await loadOwner(ownerId);
    stamp = ownerStamp(owner);
    assertInScope(actor, access.scope, stamp);
    ownerName = owner.fullName;
  } else {
    stamp = poolStamp(actor);
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { ...stamp, assignedAt: ownerId ? new Date() : null, updatedById: actor.userId },
    });
    await logActivity(tx, id, actor, {
      type: "ASSIGNMENT",
      body: note ?? null,
      data: { from: lead.owner?.fullName ?? null, to: ownerName },
    });
    await moveOpenWork(tx, id, leadStamp(updated));
    await notifyOwner(tx, actor, updated);
  });
  return getById({ actor, scope: "ALL" }, id);
};

/** Links the lead to the customer it became and closes it as CONVERTED. */
const convert = async (access, id, { customerId }) => {
  const lead = await findLead(access, id, { id: true, status: true });
  if (lead.status === "CONVERTED") throw AppError.conflict("This lead is already a customer");
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, customerCode: true, fullName: true },
  });
  if (!customer) throw invalid("customerId", "Customer not found");

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        status: "CONVERTED",
        lostReason: null,
        convertedCustomerId: customer.id,
        convertedAt: new Date(),
        updatedById: access.actor.userId,
      },
    });
    await logActivity(tx, id, access.actor, {
      type: "CONVERTED",
      fromStatus: lead.status,
      toStatus: "CONVERTED",
      body: `Became customer ${customer.customerCode} ${customer.fullName}`,
      data: { customerId: customer.id },
    });
  });
  return getById(access, id);
};

export const LeadService = {
  list,
  getById,
  checkDuplicates,
  assignees,
  create,
  update,
  remove,
  changeStatus,
  addActivity,
  assign,
  convert,
};

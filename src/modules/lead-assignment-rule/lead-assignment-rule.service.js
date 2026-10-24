import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { autoAssign, rulePool } from "#modules/lead/lead.assignment.js";
import { OPEN_STATUSES } from "#modules/lead/lead.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const select = {
  id: true,
  name: true,
  priority: true,
  isActive: true,
  locationKeywords: true,
  poolType: true,
  employeeIds: true,
  assignedCount: true,
  lastAssignedAt: true,
  createdAt: true,
  updatedAt: true,
  teamId: true,
  source: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
};

/** Adds the pool's people (active ones, in assignment order) to each rule. */
async function withPools(rules) {
  return Promise.all(
    rules.map(async ({ employeeIds: _ids, teamId: _teamId, ...rule }) => ({
      ...rule,
      pool: (await rulePool(prisma, { ...rule, employeeIds: _ids, teamId: _teamId })).map((p) => ({
        id: p.id,
        fullName: p.fullName,
      })),
    })),
  );
}

const findRule = async (id) => {
  const rule = await prisma.leadAssignmentRule.findUnique({ where: { id }, select });
  if (!rule) throw AppError.notFound("Assignment rule not found");
  return rule;
};

async function assertReferences({ sourceId, projectId, teamId, employeeIds }) {
  const [source, project, team, employees] = await Promise.all([
    sourceId ? prisma.leadSource.count({ where: { id: sourceId } }) : 1,
    projectId ? prisma.project.count({ where: { id: projectId, deletedAt: null } }) : 1,
    teamId ? prisma.team.count({ where: { id: teamId, deletedAt: null } }) : 1,
    employeeIds?.length
      ? prisma.employee.count({
          where: { id: { in: employeeIds }, deletedAt: null, employmentStatus: "ACTIVE" },
        })
      : 0,
  ]);
  if (!source) throw invalid("sourceId", "Source not found");
  if (!project) throw invalid("projectId", "Project not found");
  if (!team) throw invalid("teamId", "Team not found");
  if (employeeIds?.length && employees !== new Set(employeeIds).size) {
    throw invalid("employeeIds", "Choose active employees");
  }
}

/** Keep only the pool fields the type uses. */
const normalisePool = (data) =>
  data.poolType === "TEAM"
    ? { ...data, employeeIds: [] }
    : data.poolType === "EMPLOYEES"
      ? { ...data, teamId: null, employeeIds: [...new Set(data.employeeIds)] }
      : data;

const list = async () =>
  withPools(
    await prisma.leadAssignmentRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select,
    }),
  );

const getById = async (id) => (await withPools([await findRule(id)]))[0];

const create = async (actor, data) => {
  await assertReferences(data);
  const rule = await prisma.leadAssignmentRule.create({
    data: { ...normalisePool(data), createdById: actor.userId },
  });
  return getById(rule.id);
};

const update = async (actor, id, data) => {
  const current = await findRule(id);
  const merged = {
    poolType: data.poolType ?? current.poolType,
    teamId: data.teamId !== undefined ? data.teamId : current.teamId,
    employeeIds: data.employeeIds ?? current.employeeIds,
  };
  if (merged.poolType === "TEAM" && !merged.teamId) throw invalid("teamId", "Choose a team");
  if (merged.poolType === "EMPLOYEES" && !merged.employeeIds.length) {
    throw invalid("employeeIds", "Choose at least one employee");
  }
  await assertReferences(data);
  const poolChanged = ["poolType", "teamId", "employeeIds"].some((k) => data[k] !== undefined);
  await prisma.leadAssignmentRule.update({
    where: { id },
    data: {
      ...normalisePool({ ...data, ...(poolChanged && merged) }),
      ...(poolChanged && { nextIndex: 0 }),
      updatedById: actor.userId,
    },
  });
  return getById(id);
};

const remove = async (id) => {
  await findRule(id);
  await prisma.leadAssignmentRule.delete({ where: { id } });
};

/** Runs the rules over open leads waiting in the pool (oldest first). */
const distributePool = async (actor) => {
  const waiting = await prisma.lead.findMany({
    where: { ownerId: null, deletedAt: null, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      id: true,
      leadCode: true,
      fullName: true,
      sourceId: true,
      preferredProjectId: true,
      location: true,
    },
  });
  let assigned = 0;
  for (const lead of waiting) {
    // One transaction per lead: a later failure never undoes earlier assignments
    const result = await prisma.$transaction(async (tx) => {
      const still = await tx.lead.count({ where: { id: lead.id, ownerId: null } });
      return still ? autoAssign(tx, lead, actor) : null;
    });
    if (result) assigned += 1;
  }
  return { assigned, left: waiting.length - assigned };
};

export const LeadAssignmentRuleService = {
  list,
  getById,
  create,
  update,
  remove,
  distributePool,
};

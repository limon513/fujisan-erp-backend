import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { searchableFields, teamSelect, toTeamDto } from "./team.constant.js";

const findTeam = async (id) => {
  const team = await prisma.team.findFirst({ where: { id, deletedAt: null }, select: teamSelect });
  if (!team) throw AppError.notFound("Team not found");
  return team;
};

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/** Branch and department must exist; the leader must be an active employee of both. */
const assertConsistent = async ({ branchId, departmentId, leaderId }) => {
  const [branch, department] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } }),
    prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } }),
  ]);
  if (!branch) throw invalid("branchId", "Branch not found");
  if (!department) throw invalid("departmentId", "Department not found");
  if (!leaderId) return;

  const leader = await prisma.employee.findFirst({
    where: { id: leaderId, deletedAt: null, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
  });
  if (!leader) throw invalid("leaderId", "Team leader must be an active employee");
  if (leader.branchId !== branchId || leader.departmentId !== departmentId) {
    throw invalid("leaderId", "Team leader must belong to the team's branch and department");
  }
};

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.branchId && { branchId: query.branchId }),
    ...(query.departmentId && { departmentId: query.departmentId }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.team.findMany({ where, skip, take, orderBy, select: teamSelect }),
    prisma.team.count({ where }),
  ]);
  return { data: rows.map(toTeamDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toTeamDto(await findTeam(id));

const create = async (actor, data) => {
  await assertConsistent(data);
  const team = await prisma.team.create({ data: { ...data, createdById: actor.userId } });
  return getById(team.id);
};

const update = async (actor, id, data) => {
  const current = await findTeam(id);
  await assertConsistent({
    branchId: data.branchId ?? current.branch.id,
    departmentId: data.departmentId ?? current.department.id,
    leaderId: data.leaderId !== undefined ? data.leaderId : current.leader?.id,
  });
  await prisma.team.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

const remove = async (id) => {
  await findTeam(id);
  const members = await prisma.employee.count({ where: { teamId: id } });
  if (members) throw AppError.conflict("This team has members. Move them or deactivate the team.");
  await prisma.team.delete({ where: { id } });
};

export const TeamService = { list, getById, create, update, remove };

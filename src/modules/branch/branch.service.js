import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { branchSelect, searchableFields, toBranchDto } from "./branch.constant.js";

const findBranch = async (id) => {
  const branch = await prisma.branch.findFirst({
    where: { id, deletedAt: null },
    select: branchSelect,
  });
  if (!branch) throw AppError.notFound("Branch not found");
  return branch;
};

/** Only one head office: setting a new one unsets the others. */
const unsetOtherHeadOffices = (tx, exceptId) =>
  tx.branch.updateMany({
    where: { isHeadOffice: true, id: { not: exceptId } },
    data: { isHeadOffice: false },
  });

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.branch.findMany({ where, skip, take, orderBy, select: branchSelect }),
    prisma.branch.count({ where }),
  ]);
  return { data: rows.map(toBranchDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toBranchDto(await findBranch(id));

const create = async (actor, data) => {
  const branch = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({ data: { ...data, createdById: actor.userId } });
    if (data.isHeadOffice) await unsetOtherHeadOffices(tx, created.id);
    return created;
  });
  return getById(branch.id);
};

const update = async (actor, id, data) => {
  await findBranch(id);
  await prisma.$transaction(async (tx) => {
    await tx.branch.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
    if (data.isHeadOffice) await unsetOtherHeadOffices(tx, id);
  });
  return getById(id);
};

/** Deletes an unused branch; branches with people or teams must be deactivated instead. */
const remove = async (id) => {
  const branch = await findBranch(id);
  const inUse = await prisma.employee.count({ where: { branchId: id } });
  if (inUse || branch._count.teams) {
    throw AppError.conflict("This branch has employees or teams. Deactivate it instead.");
  }
  await prisma.branch.delete({ where: { id } });
};

export const BranchService = { list, getById, create, update, remove };

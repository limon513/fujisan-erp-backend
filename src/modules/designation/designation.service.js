import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { designationSelect, searchableFields, toDesignationDto } from "./designation.constant.js";

const findDesignation = async (id) => {
  const designation = await prisma.designation.findFirst({
    where: { id, deletedAt: null },
    select: designationSelect,
  });
  if (!designation) throw AppError.notFound("Designation not found");
  return designation;
};

const assertDepartment = async (departmentId) => {
  if (!departmentId) return;
  const exists = await prisma.department.count({ where: { id: departmentId, deletedAt: null } });
  if (!exists)
    throw AppError.unprocessable("Department not found", [
      { path: "departmentId", message: "Not found" },
    ]);
};

// The DB unique index ignores NULL departments, so company-wide names are checked here
const assertUniqueName = async (name, departmentId, exceptId) => {
  const clash = await prisma.designation.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      departmentId: departmentId ?? null,
      deletedAt: null,
      ...(exceptId && { id: { not: exceptId } }),
    },
  });
  if (clash)
    throw AppError.conflict("This designation already exists", [
      { path: "name", message: "Already exists" },
    ]);
};

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.departmentId && {
      OR: [{ departmentId: query.departmentId }, { departmentId: null }],
    }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.designation.findMany({ where, skip, take, orderBy, select: designationSelect }),
    prisma.designation.count({ where }),
  ]);
  return { data: rows.map(toDesignationDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toDesignationDto(await findDesignation(id));

const create = async (actor, data) => {
  await assertDepartment(data.departmentId);
  await assertUniqueName(data.name, data.departmentId);
  const designation = await prisma.designation.create({
    data: { ...data, createdById: actor.userId },
  });
  return getById(designation.id);
};

const update = async (actor, id, data) => {
  const current = await findDesignation(id);
  await assertDepartment(data.departmentId);
  const departmentId = data.departmentId !== undefined ? data.departmentId : current.department?.id;
  if (data.name || data.departmentId !== undefined) {
    await assertUniqueName(data.name ?? current.name, departmentId, id);
  }
  await prisma.designation.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

const remove = async (id) => {
  await findDesignation(id);
  const employees = await prisma.employee.count({ where: { designationId: id } });
  if (employees) throw AppError.conflict("Employees hold this designation. Deactivate it instead.");
  await prisma.designation.delete({ where: { id } });
};

export const DesignationService = { list, getById, create, update, remove };

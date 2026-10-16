import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { departmentSelect, searchableFields, toDepartmentDto } from "./department.constant.js";

const findDepartment = async (id) => {
  const department = await prisma.department.findFirst({
    where: { id, deletedAt: null },
    select: departmentSelect,
  });
  if (!department) throw AppError.notFound("Department not found");
  return department;
};

const assertHead = async (headId) => {
  if (!headId) return;
  const head = await prisma.employee.findFirst({
    where: { id: headId, deletedAt: null, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
  });
  if (!head)
    throw AppError.unprocessable("Department head must be an active employee", [
      { path: "headId", message: "Not an active employee" },
    ]);
};

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.department.findMany({ where, skip, take, orderBy, select: departmentSelect }),
    prisma.department.count({ where }),
  ]);
  return { data: rows.map(toDepartmentDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toDepartmentDto(await findDepartment(id));

const create = async (actor, data) => {
  await assertHead(data.headId);
  const department = await prisma.department.create({
    data: { ...data, createdById: actor.userId },
  });
  return getById(department.id);
};

const update = async (actor, id, data) => {
  await findDepartment(id);
  await assertHead(data.headId);
  await prisma.department.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

const remove = async (id) => {
  const department = await findDepartment(id);
  const employees = await prisma.employee.count({ where: { departmentId: id } });
  if (employees || department._count.teams || department._count.designations) {
    throw AppError.conflict(
      "This department has employees, teams or designations. Deactivate it instead.",
    );
  }
  await prisma.department.delete({ where: { id } });
};

export const DepartmentService = { list, getById, create, update, remove };

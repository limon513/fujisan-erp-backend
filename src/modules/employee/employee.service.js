import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { nextCode } from "#core/numbering/sequence.js";
import { assertInScope, buildScopeWhere } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  EMPLOYEE_SEQUENCE,
  employeeDetailSelect,
  employeeListSelect,
  INACTIVE_STATUSES,
  SCOPE_FIELDS,
  searchableFields,
  toEmployeeDto,
} from "./employee.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const scopeWhere = (access) => buildScopeWhere(access.actor, access.scope, SCOPE_FIELDS);

const findEmployee = async (access, id, select = employeeDetailSelect) => {
  const employee = await prisma.employee.findFirst({
    where: { id, deletedAt: null, ...scopeWhere(access) },
    select,
  });
  if (!employee) throw AppError.notFound("Employee not found");
  return employee;
};

/**
 * Org references must exist and fit together: active branch/department/designation, a designation
 * of the same department (or company-wide), a team of the same branch+department, and a reporting
 * manager that isn't the employee and doesn't create a reporting loop.
 */
async function assertOrganization({
  id,
  branchId,
  departmentId,
  designationId,
  teamId,
  reportingManagerId,
}) {
  const [branch, department, designation] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } }),
    prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } }),
    prisma.designation.findFirst({ where: { id: designationId, deletedAt: null } }),
  ]);
  if (!branch?.isActive) throw invalid("branchId", "Choose an active branch");
  if (!department?.isActive) throw invalid("departmentId", "Choose an active department");
  if (!designation?.isActive) throw invalid("designationId", "Choose an active designation");
  if (designation.departmentId && designation.departmentId !== departmentId) {
    throw invalid("designationId", "This designation belongs to another department");
  }

  if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, deletedAt: null } });
    if (!team?.isActive) throw invalid("teamId", "Choose an active team");
    if (team.branchId !== branchId || team.departmentId !== departmentId) {
      throw invalid("teamId", "The team must be in the employee's branch and department");
    }
  }

  if (reportingManagerId) {
    if (reportingManagerId === id)
      throw invalid("reportingManagerId", "An employee can't report to themselves");
    // Walk up the chain: reaching this employee again would create a loop
    let cursor = reportingManagerId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      const manager = await prisma.employee.findFirst({
        where: { id: cursor, deletedAt: null },
        select: { id: true, reportingManagerId: true },
      });
      if (!manager) throw invalid("reportingManagerId", "Reporting manager not found");
      if (id && manager.reportingManagerId === id) {
        throw invalid("reportingManagerId", "This would create a reporting loop");
      }
      cursor = manager.reportingManagerId;
    }
  }
}

const revokeLogin = (tx, employeeId, reason) =>
  tx.session.updateMany({
    where: { user: { employeeId }, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });

// ---------------------------------------------------------------------------------------------

const list = async (access, query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    AND: [scopeWhere(access)],
    ...(query.branchId && { branchId: query.branchId }),
    ...(query.departmentId && { departmentId: query.departmentId }),
    ...(query.designationId && { designationId: query.designationId }),
    ...(query.teamId && { teamId: query.teamId }),
    ...(query.employmentStatus && { employmentStatus: query.employmentStatus }),
    ...(query.hasAccount !== undefined && {
      user: query.hasAccount ? { isNot: null } : { is: null },
    }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({ where, skip, take, orderBy, select: employeeListSelect }),
    prisma.employee.count({ where }),
  ]);
  return { data: rows, meta: paginationMeta(query, total) };
};

const getById = async (access, id) => toEmployeeDto(await findEmployee(access, id));

const create = async (access, data) => {
  assertInScope(access.actor, access.scope, { id: null, ...data }, SCOPE_FIELDS);
  await assertOrganization(data);

  const employee = await prisma.$transaction(async (tx) => {
    const employeeCode = data.employeeCode ?? (await nextCode(tx, EMPLOYEE_SEQUENCE));
    return tx.employee.create({
      data: { ...data, employeeCode, createdById: access.actor.userId },
    });
  });
  return getById(access, employee.id);
};

const update = async (access, id, data) => {
  const current = await findEmployee(access, id, {
    id: true,
    branchId: true,
    departmentId: true,
    designationId: true,
    teamId: true,
    reportingManagerId: true,
    employmentStatus: true,
  });
  const next = { ...current, ...data };
  // The changed record must still be inside the editor's scope (no moving people out of reach)
  assertInScope(access.actor, access.scope, next, SCOPE_FIELDS);

  const orgChanged = [
    "branchId",
    "departmentId",
    "designationId",
    "teamId",
    "reportingManagerId",
  ].some((key) => key in data);
  if (orgChanged) {
    // Moving branch/department drops a team that no longer fits, unless a new team was given
    if (("branchId" in data || "departmentId" in data) && !("teamId" in data) && next.teamId) {
      const team = await prisma.team.findUnique({ where: { id: next.teamId } });
      if (team.branchId !== next.branchId || team.departmentId !== next.departmentId)
        next.teamId = null;
    }
    await assertOrganization(next);
  }

  const leaving = data.employmentStatus && INACTIVE_STATUSES.includes(data.employmentStatus);
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id },
      data: { ...data, teamId: next.teamId, updatedById: access.actor.userId },
    });
    if (leaving && !INACTIVE_STATUSES.includes(current.employmentStatus)) {
      await revokeLogin(tx, id, `EMPLOYMENT_${data.employmentStatus}`);
    }
  });
  return getById(access, id);
};

/**
 * Removes an employee from the directory (soft delete, history is kept). Their login is disabled,
 * and they're unlinked as team leader, department head and reporting manager.
 */
const remove = async (access, id) => {
  await findEmployee(access, id, { id: true });
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id },
      data: { deletedAt: new Date(), teamId: null, updatedById: access.actor.userId },
    });
    await tx.team.updateMany({ where: { leaderId: id }, data: { leaderId: null } });
    await tx.department.updateMany({ where: { headId: id }, data: { headId: null } });
    await tx.employee.updateMany({
      where: { reportingManagerId: id },
      data: { reportingManagerId: null },
    });
    await tx.user.updateMany({ where: { employeeId: id }, data: { status: "INACTIVE" } });
    await revokeLogin(tx, id, "EMPLOYEE_REMOVED");
  });
};

export const EmployeeService = { list, getById, create, update, remove };

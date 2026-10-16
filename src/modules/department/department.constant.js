export const searchableFields = ["code", "name", "description"];

export const sortableFields = ["name", "code", "createdAt"];

export const departmentSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  head: { select: { id: true, fullName: true, employeeCode: true } },
  _count: {
    select: { employees: { where: { deletedAt: null } }, teams: true, designations: true },
  },
};

export const toDepartmentDto = ({ _count, ...department }) => ({
  ...department,
  employeeCount: _count?.employees ?? 0,
  teamCount: _count?.teams ?? 0,
  designationCount: _count?.designations ?? 0,
});

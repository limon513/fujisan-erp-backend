export const searchableFields = ["name"];

export const sortableFields = ["level", "name", "createdAt"];

export const designationSelect = {
  id: true,
  name: true,
  level: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  _count: { select: { employees: { where: { deletedAt: null } } } },
};

export const toDesignationDto = ({ _count, ...designation }) => ({
  ...designation,
  employeeCount: _count?.employees ?? 0,
});

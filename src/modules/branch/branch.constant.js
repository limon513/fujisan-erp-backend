export const searchableFields = ["code", "name", "address", "phone"];

export const sortableFields = ["name", "code", "createdAt"];

export const branchSelect = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  email: true,
  isHeadOffice: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: { where: { deletedAt: null } }, teams: true } },
};

export const toBranchDto = ({ _count, ...branch }) => ({
  ...branch,
  employeeCount: _count?.employees ?? 0,
  teamCount: _count?.teams ?? 0,
});

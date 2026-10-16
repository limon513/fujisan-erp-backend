export const searchableFields = ["name"];

export const sortableFields = ["name", "createdAt"];

export const teamSelect = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  leader: { select: { id: true, fullName: true, employeeCode: true } },
  _count: { select: { members: { where: { deletedAt: null } } } },
};

export const toTeamDto = ({ _count, ...team }) => ({ ...team, memberCount: _count?.members ?? 0 });

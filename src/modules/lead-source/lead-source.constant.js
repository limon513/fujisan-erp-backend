export const searchableFields = ["name", "code"];

export const sortableFields = ["sortOrder", "name", "createdAt"];

export const leadSourceSelect = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { leads: { where: { deletedAt: null } } } },
};

export const toLeadSourceDto = ({ _count, ...source }) => ({
  ...source,
  leadCount: _count?.leads ?? 0,
});

/** "Walk-in visit" → "WALK_IN_VISIT" */
export const toCode = (name) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "SOURCE";

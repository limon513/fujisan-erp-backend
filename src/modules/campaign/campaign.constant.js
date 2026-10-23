export const searchableFields = ["name", "externalId"];

export const sortableFields = ["createdAt", "name", "startDate"];

export const campaignSelect = {
  id: true,
  name: true,
  budget: true,
  startDate: true,
  endDate: true,
  externalId: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  source: { select: { id: true, name: true } },
  _count: { select: { leads: { where: { deletedAt: null } } } },
};

export const toCampaignDto = ({ _count, ...campaign }) => ({
  ...campaign,
  leadCount: _count?.leads ?? 0,
});

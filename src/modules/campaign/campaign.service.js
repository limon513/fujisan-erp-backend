import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { campaignSelect, searchableFields, toCampaignDto } from "./campaign.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const findCampaign = async (id) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id, deletedAt: null },
    select: campaignSelect,
  });
  if (!campaign) throw AppError.notFound("Campaign not found");
  return campaign;
};

const assertSource = async (sourceId) => {
  if (sourceId && !(await prisma.leadSource.count({ where: { id: sourceId } }))) {
    throw invalid("sourceId", "Source not found");
  }
};

/** Start/end may be edited one at a time: check the pair as it will be stored. */
const assertDates = (current, data) => {
  const start = data.startDate !== undefined ? data.startDate : current?.startDate;
  const end = data.endDate !== undefined ? data.endDate : current?.endDate;
  if (start && end && start > end) throw invalid("endDate", "Ends before it starts");
};

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.sourceId && { sourceId: query.sourceId }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.campaign.findMany({ where, skip, take, orderBy, select: campaignSelect }),
    prisma.campaign.count({ where }),
  ]);
  return { data: rows.map(toCampaignDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toCampaignDto(await findCampaign(id));

const create = async (actor, data) => {
  await assertSource(data.sourceId);
  const campaign = await prisma.campaign.create({ data: { ...data, createdById: actor.userId } });
  return getById(campaign.id);
};

const update = async (actor, id, data) => {
  const current = await findCampaign(id);
  await assertSource(data.sourceId);
  assertDates(current, data);
  await prisma.campaign.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

/** Soft delete; leads keep the link so their history stays readable. */
const remove = async (actor, id) => {
  await findCampaign(id);
  await prisma.campaign.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, externalId: null, updatedById: actor.userId },
  });
};

export const CampaignService = { list, getById, create, update, remove };

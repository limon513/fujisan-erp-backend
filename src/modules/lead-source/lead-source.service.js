import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  leadSourceSelect,
  searchableFields,
  toCode,
  toLeadSourceDto,
} from "./lead-source.constant.js";

const findSource = async (id) => {
  const source = await prisma.leadSource.findUnique({ where: { id }, select: leadSourceSelect });
  if (!source) throw AppError.notFound("Lead source not found");
  return source;
};

const assertUniqueName = async (name, exceptId) => {
  const clash = await prisma.leadSource.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId && { id: { not: exceptId } }),
    },
  });
  if (clash) {
    throw AppError.conflict("This source already exists", [
      { path: "name", message: "Already exists" },
    ]);
  }
};

/** A unique code from the name: FACEBOOK, then FACEBOOK_2, ... */
async function uniqueCode(name) {
  const base = toCode(name);
  for (let n = 1; ; n += 1) {
    const code = n === 1 ? base : `${base}_${n}`;
    if (!(await prisma.leadSource.count({ where: { code } }))) return code;
  }
}

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    ...(query.isActive !== undefined && { isActive: query.isActive }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.leadSource.findMany({
      where,
      skip,
      take,
      orderBy: [orderBy, { name: "asc" }],
      select: leadSourceSelect,
    }),
    prisma.leadSource.count({ where }),
  ]);
  return { data: rows.map(toLeadSourceDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => toLeadSourceDto(await findSource(id));

const create = async (actor, data) => {
  await assertUniqueName(data.name);
  const source = await prisma.leadSource.create({
    data: { ...data, code: await uniqueCode(data.name), createdById: actor.userId },
  });
  return getById(source.id);
};

const update = async (actor, id, data) => {
  await findSource(id);
  if (data.name) await assertUniqueName(data.name, id);
  await prisma.leadSource.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

const remove = async (id) => {
  await findSource(id);
  const leads = await prisma.lead.count({ where: { sourceId: id } });
  if (leads) throw AppError.conflict("Leads came from this source. Switch it off instead.");
  await prisma.$transaction([
    prisma.campaign.updateMany({ where: { sourceId: id }, data: { sourceId: null } }),
    prisma.leadSource.delete({ where: { id } }),
  ]);
};

export const LeadSourceService = { list, getById, create, update, remove };

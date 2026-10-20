import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { contentUrl } from "#modules/file/file.service.js";
import { PLOT_STATUSES, projectSelect, searchableFields } from "./project.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/** { AVAILABLE: n, HOLD: n, ... , total } per project id */
async function plotCounts(projectIds) {
  const rows = await prisma.plot.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projectIds }, deletedAt: null },
    _count: { _all: true },
  });
  const empty = () => ({ ...Object.fromEntries(PLOT_STATUSES.map((s) => [s, 0])), total: 0 });
  const counts = Object.fromEntries(projectIds.map((id) => [id, empty()]));
  for (const row of rows) {
    counts[row.projectId][row.status] = row._count._all;
    counts[row.projectId].total += row._count._all;
  }
  return counts;
}

const toDto = ({ _count, layoutFileId, layoutWidth, layoutHeight, ...project }, counts) => ({
  ...project,
  blockCount: _count?.blocks ?? 0,
  roadCount: _count?.roads ?? 0,
  plots: counts,
  layout: layoutFileId
    ? {
        fileId: layoutFileId,
        width: layoutWidth,
        height: layoutHeight,
        url: contentUrl(layoutFileId),
      }
    : null,
});

const findProject = async (id) => {
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    select: projectSelect,
  });
  if (!project) throw AppError.notFound("Project not found");
  return project;
};

const assertReferences = async ({ branchId, projectManagerId }) => {
  if (branchId && !(await prisma.branch.count({ where: { id: branchId, deletedAt: null } }))) {
    throw invalid("branchId", "Branch not found");
  }
  if (
    projectManagerId &&
    !(await prisma.employee.count({ where: { id: projectManagerId, deletedAt: null } }))
  ) {
    throw invalid("projectManagerId", "Employee not found");
  }
};

// ---------------------------------------------------------------------------------------------

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = {
    ...searchWhere,
    deletedAt: null,
    ...(query.status && { status: query.status }),
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.branchId && { branchId: query.branchId }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.project.findMany({ where, skip, take, orderBy, select: projectSelect }),
    prisma.project.count({ where }),
  ]);
  const counts = await plotCounts(rows.map((r) => r.id));
  return {
    data: rows.map((row) => toDto(row, counts[row.id])),
    meta: paginationMeta(query, total),
  };
};

const getById = async (id) => {
  const project = await findProject(id);
  const counts = await plotCounts([id]);
  return toDto(project, counts[id]);
};

const create = async (actor, data) => {
  await assertReferences(data);
  const project = await prisma.project.create({ data: { ...data, createdById: actor.userId } });
  return getById(project.id);
};

const update = async (actor, id, data) => {
  await findProject(id);
  await assertReferences(data);
  await prisma.project.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
  return getById(id);
};

/** Only projects without plots can be deleted (their blocks and roads go too). */
const remove = async (id) => {
  await findProject(id);
  if (await prisma.plot.count({ where: { projectId: id } })) {
    throw AppError.conflict("This project has plots. Deactivate it instead.");
  }
  await prisma.$transaction([
    prisma.block.deleteMany({ where: { projectId: id } }),
    prisma.road.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);
};

/** Sets the master-plan image. Its pixel size becomes the plot map's coordinate space. */
const setLayout = async (actor, id, { fileId }) => {
  await findProject(id);
  const file = await prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
  if (!file) throw invalid("fileId", "File not found");
  if (!file.mimeType.startsWith("image/") || !file.width || !file.height) {
    throw invalid("fileId", "The layout must be an image (JPEG, PNG or WebP)");
  }
  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        layoutFileId: file.id,
        layoutWidth: file.width,
        layoutHeight: file.height,
        updatedById: actor.userId,
      },
    }),
    prisma.file.update({
      where: { id: file.id },
      data: { entityType: "Project", entityId: id, category: "LAYOUT" },
    }),
  ]);
  return getById(id);
};

const removeLayout = async (actor, id) => {
  await findProject(id);
  await prisma.project.update({
    where: { id },
    data: { layoutFileId: null, layoutWidth: null, layoutHeight: null, updatedById: actor.userId },
  });
  return getById(id);
};

// --- blocks & roads ---------------------------------------------------------------------------

const childApi = (model, { label, orderBy }) => {
  const find = async (projectId, childId) => {
    const row = await prisma[model].findFirst({ where: { id: childId, projectId } });
    if (!row) throw AppError.notFound(`${label} not found`);
    return row;
  };

  return {
    list: async (projectId) => {
      await findProject(projectId);
      const rows = await prisma[model].findMany({
        where: { projectId },
        orderBy,
        include: { _count: { select: { plots: { where: { deletedAt: null } } } } },
      });
      return rows.map(({ _count, ...row }) => ({ ...row, plotCount: _count.plots }));
    },
    create: async (actor, projectId, data) => {
      await findProject(projectId);
      return prisma[model].create({ data: { ...data, projectId, createdById: actor.userId } });
    },
    update: async (actor, projectId, childId, data) => {
      await find(projectId, childId);
      return prisma[model].update({
        where: { id: childId },
        data: { ...data, updatedById: actor.userId },
      });
    },
    remove: async (projectId, childId) => {
      await find(projectId, childId);
      if (await prisma.plot.count({ where: { [`${model}Id`]: childId } })) {
        throw AppError.conflict(`This ${label.toLowerCase()} has plots. Deactivate it instead.`);
      }
      await prisma[model].delete({ where: { id: childId } });
    },
  };
};

export const BlockService = childApi("block", {
  label: "Block",
  orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
});
export const RoadService = childApi("road", { label: "Road", orderBy: { name: "asc" } });

export const ProjectService = { list, getById, create, update, remove, setLayout, removeLayout };

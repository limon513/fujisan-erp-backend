import { z } from "zod";
import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { PlotHoldService } from "./plot.hold.service.js";
import { readPlotSheet } from "./plot.import.js";
import {
  holdHistoryQuery,
  FACINGS,
  LOCKED_STATUSES,
  plotDetailSelect,
  plotListSelect,
  toPlotDto,
} from "./plot.constant.js";
import { area, money } from "./plot.validation.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const plotCode = (blockCode, plotNumber) => `${blockCode}-${plotNumber}`.toUpperCase();

const findPlot = async (id, select = plotDetailSelect) => {
  const plot = await prisma.plot.findFirst({ where: { id, deletedAt: null }, select });
  if (!plot) throw AppError.notFound("Plot not found");
  return plot;
};

/** Block (and road, if given) must belong to the project. */
async function resolveLocation(projectId, { blockId, roadId }) {
  const block = await prisma.block.findFirst({ where: { id: blockId, projectId } });
  if (!block) throw invalid("blockId", "Choose a block of this project");
  if (roadId) {
    const road = await prisma.road.findFirst({ where: { id: roadId, projectId } });
    if (!road) throw invalid("roadId", "Choose a road of this project");
  }
  return block;
}

// ---------------------------------------------------------------------------------------------

const list = async (query) => {
  // Holds also expire on read, so the list is right even if the background job hasn't run
  // (e.g. the hosted instance was asleep).
  await PlotHoldService.expireDueHolds();
  const { skip, take, orderBy } = buildListArgs(query);
  const range = (min, max) =>
    min !== undefined || max !== undefined
      ? { ...(min !== undefined && { gte: min }), ...(max !== undefined && { lte: max }) }
      : undefined;

  const where = {
    deletedAt: null,
    ...(query.projectId && { projectId: query.projectId }),
    ...(query.blockId && { blockId: query.blockId }),
    ...(query.roadId && { roadId: query.roadId }),
    ...(query.status && { status: query.status }),
    ...(query.facing && { facing: query.facing }),
    ...(range(query.minArea, query.maxArea) && { areaSqft: range(query.minArea, query.maxArea) }),
    ...(range(query.minPrice, query.maxPrice) && { price: range(query.minPrice, query.maxPrice) }),
    ...(query.search && {
      OR: [
        { code: { contains: query.search, mode: "insensitive" } },
        { plotNumber: { contains: query.search, mode: "insensitive" } },
      ],
    }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.plot.findMany({ where, skip, take, orderBy, select: plotListSelect }),
    prisma.plot.count({ where }),
  ]);
  return { data: rows.map(toPlotDto), meta: paginationMeta(query, total) };
};

const getById = async (id) => {
  await PlotHoldService.expireDueHolds();
  const [plot, holdHistory] = await Promise.all([
    findPlot(id),
    prisma.plotHold.findMany({ where: { plotId: id }, ...holdHistoryQuery }),
  ]);
  return { ...toPlotDto(plot), holdHistory };
};

const create = async (actor, { projectId, price, ...data }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) throw invalid("projectId", "Project not found");
  const block = await resolveLocation(projectId, data);

  const plot = await prisma.$transaction(async (tx) => {
    const created = await tx.plot.create({
      data: {
        ...data,
        projectId,
        price,
        code: plotCode(block.code, data.plotNumber),
        createdById: actor.userId,
      },
    });
    await tx.plotStatusHistory.create({
      data: {
        plotId: created.id,
        toStatus: "AVAILABLE",
        refType: "CREATE",
        changedById: actor.userId,
      },
    });
    await tx.plotPriceHistory.create({
      data: {
        plotId: created.id,
        newPrice: price,
        reason: "Initial price",
        changedById: actor.userId,
      },
    });
    return created;
  });
  return getById(plot.id);
};

/** Edits plot details. Price and status have their own actions; booked/sold plots are locked. */
const update = async (actor, id, data) => {
  const plot = await findPlot(id, {
    id: true,
    projectId: true,
    blockId: true,
    roadId: true,
    plotNumber: true,
    status: true,
  });
  const structural = ["blockId", "plotNumber", "areaSqft"].some((key) => key in data);
  if (structural && LOCKED_STATUSES.includes(plot.status)) {
    throw AppError.unprocessable("Booked or sold plots can't change block, number or area");
  }

  const next = { ...plot, ...data };
  const block = await resolveLocation(plot.projectId, next);
  await prisma.plot.update({
    where: { id },
    data: {
      ...data,
      ...(("blockId" in data || "plotNumber" in data) && {
        code: plotCode(block.code, next.plotNumber),
      }),
      updatedById: actor.userId,
    },
  });
  return getById(id);
};

const changePrice = async (actor, id, { price, reason }) => {
  const plot = await findPlot(id, { id: true, price: true, status: true, code: true });
  if (LOCKED_STATUSES.includes(plot.status)) {
    throw AppError.unprocessable("The price of a booked or sold plot can't change");
  }
  if (Number(plot.price) === price) throw invalid("price", "That's already the price");

  await prisma.$transaction(async (tx) => {
    await tx.plot.update({ where: { id }, data: { price, updatedById: actor.userId } });
    await tx.plotPriceHistory.create({
      data: {
        plotId: id,
        oldPrice: plot.price,
        newPrice: price,
        reason,
        changedById: actor.userId,
      },
    });
  });
  await recordAudit({
    action: "PRICE_CHANGED",
    entityType: "Plot",
    entityId: id,
    description: `Changed the price of plot ${plot.code}: ${reason}`,
    oldValues: { price: plot.price.toString() },
    newValues: { price: String(price) },
  });
  return getById(id);
};

/** Deletes a plot that was never held or booked (a data-entry mistake). Otherwise block it. */
const remove = async (id) => {
  const plot = await findPlot(id, { id: true, status: true });
  const held = await prisma.plotHold.count({ where: { plotId: id } });
  if (held || !["AVAILABLE", "BLOCKED"].includes(plot.status)) {
    throw AppError.conflict(
      "This plot has a hold or booking history. Block it instead of deleting.",
    );
  }
  await prisma.plot.delete({ where: { id } });
};

// --- import -----------------------------------------------------------------------------------

const FACING_ALIASES = {
  N: "NORTH",
  S: "SOUTH",
  E: "EAST",
  W: "WEST",
  NE: "NORTH_EAST",
  NW: "NORTH_WEST",
  SE: "SOUTH_EAST",
  SW: "SOUTH_WEST",
};

const normalizeFacing = (value) => {
  if (!value) return null;
  const key = value.toUpperCase().replace(/[\s-]+/g, "_");
  return FACING_ALIASES[key] ?? (FACINGS.includes(key) ? key : undefined);
};

const rowSchema = z.object({
  block: z
    .string()
    .trim()
    .min(1, "Block is required")
    .max(10)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits or -"),
  plotNumber: z
    .string()
    .trim()
    .min(1, "Plot is required")
    .max(20)
    .regex(/^[A-Za-z0-9/-]+$/, "Letters, digits, - or /"),
  areaSqft: area,
  price: money,
  road: z.string().trim().max(60).optional(),
  dimensions: z.string().trim().max(40).optional(),
  remarks: z.string().trim().max(500).optional(),
});

/**
 * Imports plots from an .xlsx/.csv. With dryRun only validates and previews. Missing blocks
 * (by code) and roads (by name) are created. All-or-nothing: any error → nothing is saved.
 */
const importPlots = async (actor, file, { projectId, dryRun }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) throw invalid("projectId", "Project not found");
  const rows = await readPlotSheet(file);

  const [blocks, roads, existing] = await Promise.all([
    prisma.block.findMany({ where: { projectId } }),
    prisma.road.findMany({ where: { projectId } }),
    prisma.plot.findMany({ where: { projectId }, select: { code: true } }),
  ]);
  const blockByCode = new Map(blocks.map((b) => [b.code.toUpperCase(), b]));
  const roadByName = new Map(roads.map((r) => [r.name.toLowerCase(), r]));
  const existingCodes = new Set(existing.map((p) => p.code));

  const errors = [];
  const plots = [];
  const seen = new Map();
  const newBlocks = new Set();
  const newRoads = new Map();

  for (const row of rows) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: row.rowNumber, field: String(issue.path[0]), message: issue.message });
      }
      continue;
    }
    const value = parsed.data;
    const facing = normalizeFacing(row.facing);
    if (facing === undefined) {
      errors.push({
        row: row.rowNumber,
        field: "facing",
        message: `Unknown facing "${row.facing}"`,
      });
      continue;
    }
    const blockCode = value.block.toUpperCase();
    const code = plotCode(blockCode, value.plotNumber);
    if (seen.has(code)) {
      errors.push({
        row: row.rowNumber,
        field: "plotNumber",
        message: `Plot ${code} repeats row ${seen.get(code)}`,
      });
      continue;
    }
    if (existingCodes.has(code)) {
      errors.push({
        row: row.rowNumber,
        field: "plotNumber",
        message: `Plot ${code} already exists`,
      });
      continue;
    }
    seen.set(code, row.rowNumber);
    if (!blockByCode.has(blockCode)) newBlocks.add(blockCode);
    if (value.road && !roadByName.has(value.road.toLowerCase()))
      newRoads.set(value.road.toLowerCase(), value.road);
    plots.push({ ...value, blockCode, code, facing });
  }

  const summary = {
    rows: rows.length,
    valid: plots.length,
    errors,
    newBlocks: [...newBlocks],
    newRoads: [...newRoads.values()],
    preview: plots.slice(0, 20).map(({ code, areaSqft, price, road, facing }) => ({
      code,
      areaSqft,
      price,
      road: road ?? null,
      facing,
    })),
    created: 0,
  };
  if (dryRun) return summary;
  if (errors.length)
    throw AppError.unprocessable(
      "Fix the errors in the file before importing",
      errors.map((e) => ({ path: `row ${e.row}: ${e.field}`, message: e.message })),
    );

  await prisma.$transaction(
    async (tx) => {
      for (const code of newBlocks) {
        blockByCode.set(
          code,
          await tx.block.create({
            data: { projectId, code, name: `Block ${code}`, createdById: actor.userId },
          }),
        );
      }
      for (const [key, name] of newRoads) {
        roadByName.set(
          key,
          await tx.road.create({ data: { projectId, name, createdById: actor.userId } }),
        );
      }
      const records = plots.map((p) => ({
        projectId,
        blockId: blockByCode.get(p.blockCode).id,
        roadId: p.road ? roadByName.get(p.road.toLowerCase()).id : null,
        plotNumber: p.plotNumber,
        code: p.code,
        areaSqft: p.areaSqft,
        price: p.price,
        facing: p.facing,
        dimensions: p.dimensions || null,
        remarks: p.remarks || null,
        createdById: actor.userId,
      }));
      await tx.plot.createMany({ data: records });
      const created = await tx.plot.findMany({
        where: { projectId, code: { in: records.map((r) => r.code) } },
        select: { id: true, price: true },
      });
      await tx.plotStatusHistory.createMany({
        data: created.map((p) => ({
          plotId: p.id,
          toStatus: "AVAILABLE",
          refType: "CREATE",
          reason: "Imported",
          changedById: actor.userId,
        })),
      });
      await tx.plotPriceHistory.createMany({
        data: created.map((p) => ({
          plotId: p.id,
          newPrice: p.price,
          reason: "Imported",
          changedById: actor.userId,
        })),
      });
    },
    { timeout: 60_000 },
  );

  await recordAudit({
    action: "PLOTS_IMPORTED",
    entityType: "Project",
    entityId: projectId,
    description: `Imported ${plots.length} plots into ${project.name}`,
  });
  return { ...summary, created: plots.length };
};

export const PlotService = { list, getById, create, update, changePrice, remove, importPlots };

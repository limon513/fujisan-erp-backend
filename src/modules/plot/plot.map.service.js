import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { contentUrl } from "#modules/file/file.service.js";
import { PlotHoldService } from "./plot.hold.service.js";
import { PLOT_STATUSES } from "./plot.constant.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);
const round = (n) => Math.round(n * 10) / 10;

/** Area-weighted centroid of a simple polygon (falls back to the vertex average). */
export function polygonCentroid(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const n = points.length;
    return {
      x: points.reduce((s, p) => s + p[0], 0) / n,
      y: points.reduce((s, p) => s + p[1], 0) / n,
    };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/**
 * Everything the plot map needs in one request: the layout image and every plot with its
 * shape, status and active hold. Coordinates are in layout-image pixels.
 */
const getMap = async (projectId) => {
  await PlotHoldService.expireDueHolds();
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      layoutFileId: true,
      layoutWidth: true,
      layoutHeight: true,
    },
  });
  if (!project) throw AppError.notFound("Project not found");

  const plots = await prisma.plot.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      plotNumber: true,
      status: true,
      areaSqft: true,
      price: true,
      facing: true,
      mapShape: true,
      mapLabel: true,
      block: { select: { id: true, code: true, name: true } },
      holds: { where: { status: "ACTIVE" }, take: 1, select: { expiresAt: true } },
    },
  });

  const counts = Object.fromEntries(PLOT_STATUSES.map((s) => [s, 0]));
  for (const plot of plots) counts[plot.status]++;

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      layout: project.layoutFileId
        ? {
            url: contentUrl(project.layoutFileId),
            width: project.layoutWidth,
            height: project.layoutHeight,
          }
        : null,
    },
    counts: { ...counts, total: plots.length, mapped: plots.filter((p) => p.mapShape).length },
    plots: plots.map(({ holds, ...plot }) => ({
      ...plot,
      holdExpiresAt: holds[0]?.expiresAt ?? null,
    })),
  };
};

/** Saves (or clears with null) a plot's outline on the layout image. */
const setShape = async (actor, plotId, { points, label }) => {
  const plot = await prisma.plot.findFirst({
    where: { id: plotId, deletedAt: null },
    select: { id: true, project: { select: { layoutWidth: true, layoutHeight: true } } },
  });
  if (!plot) throw AppError.notFound("Plot not found");

  if (points === null) {
    await prisma.plot.update({
      where: { id: plotId },
      data: { mapShape: null, mapLabel: null, updatedById: actor.userId },
    });
    return;
  }

  const { layoutWidth: width, layoutHeight: height } = plot.project;
  if (!width || !height) throw invalid("points", "Upload the project's layout image first");
  const outside = points.some(([x, y]) => x < 0 || y < 0 || x > width || y > height);
  if (outside)
    throw invalid("points", `Points must lie inside the layout image (${width} × ${height})`);

  const rounded = points.map(([x, y]) => [round(x), round(y)]);
  const center = label ?? polygonCentroid(rounded);
  await prisma.plot.update({
    where: { id: plotId },
    data: {
      mapShape: { points: rounded },
      mapLabel: { x: round(center.x), y: round(center.y) },
      updatedById: actor.userId,
    },
  });
};

export const PlotMapService = { getMap, setShape };

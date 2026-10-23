import prisma from "#core/db/prisma.js";
import { can } from "#core/rbac/authorize.js";
import { buildScopeWhere } from "#core/rbac/scope.js";
import { PlotHoldService } from "#modules/plot/plot.hold.service.js";

const STATUSES = ["AVAILABLE", "HOLD", "BOOKED", "SOLD", "BLOCKED"];
const EXPIRING_WITHIN_MS = 48 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** First instant of the current calendar month in Asia/Dhaka. */
export function startOfDhakaMonth(now = new Date()) {
  const dhaka = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return new Date(Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), 1) - DHAKA_OFFSET_MS);
}

const holdSelect = {
  id: true,
  days: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  prospectName: true,
  plot: { select: { id: true, code: true, project: { select: { id: true, name: true } } } },
  requestedBy: { select: { id: true, fullName: true } },
  customer: { select: { id: true, fullName: true, customerCode: true } },
};

async function inventory() {
  const [byProjectStatus, projects, availableValue] = await Promise.all([
    prisma.plot.groupBy({
      by: ["projectId", "status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.project.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.plot.aggregate({
      where: { deletedAt: null, status: "AVAILABLE" },
      _sum: { price: true },
    }),
  ]);

  const empty = () => ({ ...Object.fromEntries(STATUSES.map((s) => [s, 0])), total: 0 });
  const totals = empty();
  const perProject = new Map(projects.map((p) => [p.id, { ...p, plots: empty() }]));
  for (const row of byProjectStatus) {
    const count = row._count._all;
    totals[row.status] += count;
    totals.total += count;
    const project = perProject.get(row.projectId);
    if (project) {
      project.plots[row.status] += count;
      project.plots.total += count;
    }
  }
  return {
    totals,
    availableValue: (availableValue._sum.price ?? 0).toString(),
    projects: [...perProject.values()],
  };
}

/**
 * Role-aware dashboard: each section is included only when the user may see that data, and
 * customer numbers follow their data scope.
 */
const summary = async (actor) => {
  await PlotHoldService.expireDueHolds();
  const now = new Date();
  const result = { generatedAt: now.toISOString() };

  if (can(actor, "plot.view")) {
    const [inv, activeHolds, expiringSoon] = await Promise.all([
      inventory(),
      prisma.plotHold.count({ where: { status: "ACTIVE" } }),
      prisma.plotHold.findMany({
        where: {
          status: "ACTIVE",
          expiresAt: { lte: new Date(now.getTime() + EXPIRING_WITHIN_MS) },
        },
        orderBy: { expiresAt: "asc" },
        take: 10,
        select: holdSelect,
      }),
    ]);
    result.inventory = { ...inv, activeHolds };
    result.expiringHolds = expiringSoon;
  }

  if (actor.employeeId) {
    result.myHolds = await prisma.plotHold.findMany({
      where: { requestedById: actor.employeeId, status: "ACTIVE" },
      orderBy: { expiresAt: "asc" },
      take: 10,
      select: holdSelect,
    });
  }

  if (can(actor, "customer.view")) {
    const scope = actor.isSuperAdmin ? "ALL" : actor.permissions["customer.view"];
    const where = { deletedAt: null, AND: [buildScopeWhere(actor, scope)] };
    const [total, newThisMonth] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.count({ where: { ...where, createdAt: { gte: startOfDhakaMonth(now) } } }),
    ]);
    result.customers = { total, newThisMonth, scope };
  }

  if (can(actor, "employee.view")) {
    result.people = {
      activeEmployees: await prisma.employee.count({
        where: { deletedAt: null, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
      }),
    };
  }

  return result;
};

export const DashboardService = { summary };

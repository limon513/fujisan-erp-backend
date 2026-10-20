import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import logger from "#core/utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayText = (days) => `${days} day${days === 1 ? "" : "s"}`;
const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

const findPlot = async (id) => {
  const plot = await prisma.plot.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      code: true,
      status: true,
      project: { select: { name: true, defaultHoldDays: true } },
    },
  });
  if (!plot) throw AppError.notFound("Plot not found");
  return plot;
};

/**
 * Moves a plot between statuses only if it is still in `from` (concurrency-safe), and records
 * the change in its status history. Returns false when someone else changed it first.
 */
async function transition(tx, plotId, from, to, history) {
  const { count } = await tx.plot.updateMany({
    where: { id: plotId, status: from, deletedAt: null },
    data: { status: to, statusChangedAt: new Date() },
  });
  if (!count) return false;
  await tx.plotStatusHistory.create({
    data: { plotId, fromStatus: from, toStatus: to, ...history },
  });
  return true;
}

/**
 * Puts an AVAILABLE plot on hold for `days`, on behalf of the employee who asked for it.
 * Only one active hold per plot — guarded by a conditional update and a partial unique index.
 */
const hold = async (
  actor,
  plotId,
  { requestedById, days, reason, customerId, prospectName, prospectMobile },
) => {
  const plot = await findPlot(plotId);
  if (plot.status !== "AVAILABLE") {
    throw AppError.conflict(`Plot ${plot.code} is ${plot.status.toLowerCase()}, not available`);
  }
  const requester = await prisma.employee.findFirst({
    where: { id: requestedById, deletedAt: null, employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
  });
  if (!requester) throw invalid("requestedById", "Choose an active employee");
  if (
    customerId &&
    !(await prisma.customer.count({ where: { id: customerId, deletedAt: null } }))
  ) {
    throw invalid("customerId", "Customer not found");
  }

  const holdDays = days ?? plot.project.defaultHoldDays;
  const expiresAt = new Date(Date.now() + holdDays * DAY_MS);

  const created = await prisma.$transaction(async (tx) => {
    const placed = await tx.plotHold.create({
      data: {
        plotId,
        requestedById,
        heldById: actor.userId,
        customerId: customerId ?? null,
        prospectName: prospectName ?? null,
        prospectMobile: prospectMobile ?? null,
        reason,
        days: holdDays,
        expiresAt,
      },
    });
    const moved = await transition(tx, plotId, "AVAILABLE", "HOLD", {
      refType: "HOLD",
      refId: placed.id,
      reason: `${reason} (requested by ${requester.fullName}, ${dayText(holdDays)})`,
      changedById: actor.userId,
    });
    if (!moved) throw AppError.conflict(`Plot ${plot.code} was just taken by someone else`);
    return placed;
  });

  await recordAudit({
    action: "PLOT_HOLD",
    entityType: "Plot",
    entityId: plotId,
    description: `Held plot ${plot.code} for ${dayText(holdDays)}, requested by ${requester.fullName}`,
    newValues: {
      holdId: created.id,
      requestedBy: requester.fullName,
      days: holdDays,
      expiresAt: expiresAt.toISOString(),
      reason,
    },
  });
};

const release = async (actor, plotId, { reason }) => {
  const plot = await findPlot(plotId);
  const active = await prisma.plotHold.findFirst({ where: { plotId, status: "ACTIVE" } });
  if (plot.status !== "HOLD" || !active)
    throw AppError.conflict(`Plot ${plot.code} is not on hold`);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.plotHold.updateMany({
      where: { id: active.id, status: "ACTIVE" },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedById: actor.userId,
        releaseReason: reason,
      },
    });
    if (!count) throw AppError.conflict("The hold has already ended");
    await transition(tx, plotId, "HOLD", "AVAILABLE", {
      refType: "RELEASE",
      refId: active.id,
      reason,
      changedById: actor.userId,
    });
  });
  await recordAudit({
    action: "PLOT_RELEASE",
    entityType: "Plot",
    entityId: plotId,
    description: `Released the hold on plot ${plot.code}: ${reason}`,
  });
};

/** Takes an AVAILABLE plot off the market (BLOCKED), or puts it back. */
const setBlocked = async (actor, plotId, blocked, { reason }) => {
  const plot = await findPlot(plotId);
  const [from, to] = blocked ? ["AVAILABLE", "BLOCKED"] : ["BLOCKED", "AVAILABLE"];
  if (plot.status !== from) {
    throw AppError.conflict(
      blocked
        ? `Only available plots can be blocked (${plot.code} is ${plot.status.toLowerCase()})`
        : `Plot ${plot.code} is not blocked`,
    );
  }
  const moved = await prisma.$transaction((tx) =>
    transition(tx, plotId, from, to, {
      refType: blocked ? "BLOCK" : "UNBLOCK",
      reason,
      changedById: actor.userId,
    }),
  );
  if (!moved) throw AppError.conflict(`Plot ${plot.code} changed in the meantime, try again`);
  await recordAudit({
    action: blocked ? "PLOT_BLOCK" : "PLOT_UNBLOCK",
    entityType: "Plot",
    entityId: plotId,
    description: `${blocked ? "Blocked" : "Unblocked"} plot ${plot.code}: ${reason}`,
  });
};

/**
 * Ends every ACTIVE hold whose time is up: hold → EXPIRED, plot → AVAILABLE, history written,
 * the person who placed the hold and the requester are notified. Safe to run concurrently and
 * repeatedly (each step is conditional). Returns the number of holds expired.
 */
const expireDueHolds = async () => {
  const due = await prisma.plotHold.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
    take: 500,
    select: {
      id: true,
      plotId: true,
      heldById: true,
      days: true,
      plot: { select: { code: true } },
      requestedBy: { select: { fullName: true, user: { select: { id: true } } } },
    },
  });

  let expired = 0;
  for (const holdRow of due) {
    try {
      const done = await prisma.$transaction(async (tx) => {
        const { count } = await tx.plotHold.updateMany({
          where: { id: holdRow.id, status: "ACTIVE" },
          data: {
            status: "EXPIRED",
            releasedAt: new Date(),
            releaseReason: `Hold period of ${dayText(holdRow.days)} ended`,
          },
        });
        if (!count) return false;
        await transition(tx, holdRow.plotId, "HOLD", "AVAILABLE", {
          refType: "EXPIRY",
          refId: holdRow.id,
          reason: `Hold period of ${dayText(holdRow.days)} ended`,
        });
        const recipients = new Set(
          [holdRow.heldById, holdRow.requestedBy.user?.id].filter(Boolean),
        );
        await tx.notification.createMany({
          data: [...recipients].map((userId) => ({
            userId,
            type: "PLOT_HOLD_EXPIRED",
            title: `Hold on plot ${holdRow.plot.code} expired`,
            body: `The ${dayText(holdRow.days)} hold requested by ${holdRow.requestedBy.fullName} has ended; the plot is available again.`,
            link: `/plots?search=${encodeURIComponent(holdRow.plot.code)}`,
            data: { plotId: holdRow.plotId, holdId: holdRow.id },
          })),
        });
        return true;
      });
      if (done) expired++;
    } catch (error) {
      logger.error({ err: error, holdId: holdRow.id }, "Failed to expire plot hold");
    }
  }
  if (expired) logger.info(`Expired ${expired} plot hold(s)`);
  return expired;
};

export const PlotHoldService = { hold, release, setBlocked, expireDueHolds };

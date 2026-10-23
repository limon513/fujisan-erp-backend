import config from "#config/index.js";
import logger from "#core/utils/logger.js";
import { FollowUpService } from "#modules/follow-up/follow-up.service.js";
import { NotificationService } from "#modules/notification/notification.service.js";
import { PlotHoldService } from "#modules/plot/plot.hold.service.js";
import { SiteVisitService } from "#modules/site-visit/site-visit.service.js";

/**
 * Recurring background jobs (single process). Each job must be idempotent and safe to run on
 * several instances at once — they are, because every update is conditional on current state.
 * (A queue such as pg-boss can replace this when jobs need retries or scheduling by date.)
 */
const JOBS = [
  { name: "plot-hold-expiry", everyMs: 60_000, run: () => PlotHoldService.expireDueHolds() },
  { name: "follow-up-reminders", everyMs: 60_000, run: () => FollowUpService.sendReminders() },
  { name: "site-visit-reminders", everyMs: 60_000, run: () => SiteVisitService.sendReminders() },
  { name: "notification-prune", everyMs: 6 * 3_600_000, run: () => NotificationService.prune() },
];

export function startJobs() {
  if (config.isTest) return () => {};
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (error) {
        logger.error({ err: error, job: job.name }, "Background job failed");
      } finally {
        running = false;
      }
    };
    tick();
    return setInterval(tick, job.everyMs).unref();
  });
  logger.info(`Background jobs started: ${JOBS.map((j) => j.name).join(", ")}`);
  return () => timers.forEach(clearInterval);
}

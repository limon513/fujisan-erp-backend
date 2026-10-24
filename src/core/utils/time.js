/** Bangladesh time helpers. Asia/Dhaka is UTC+6 all year (no daylight saving). */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start and end (exclusive) of the Dhaka calendar day containing `now`, as UTC instants. */
export function dhakaDay(now = new Date()) {
  const dhaka = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const start = new Date(
    Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth(), dhaka.getUTCDate()) - DHAKA_OFFSET_MS,
  );
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

const dhakaFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "25 Oct, 10:30 am" in Dhaka time, for timeline and notification text. */
export const formatDhaka = (date) => dhakaFormat.format(new Date(date));

/** Today's Dhaka calendar date at UTC midnight (the convention for @db.Date columns). */
export const dhakaDate = (now = new Date()) =>
  new Date(dhakaDay(now).start.getTime() + DHAKA_OFFSET_MS);

/** Whole days from `from` to `to` (both date-only values at UTC midnight). */
export const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

/** First day of `date`'s month and of the next one (date-only, UTC midnight). */
export function monthOf(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

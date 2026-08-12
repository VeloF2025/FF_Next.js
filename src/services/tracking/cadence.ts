/**
 * Whether a provider/account is due for a poll.
 *
 * The cron fires at the fastest supported rate and each account decides for
 * itself, so one portal can be ramped without touching the others and without a
 * deploy. The alternative — one cron entry per account — puts the cadence back
 * in a crontab where the code cannot see it.
 */

/**
 * Cron fires on the minute; last_run_at is stamped a few seconds later, so the
 * measured gap is reliably a hair under the interval. Without grace, a 120-minute
 * interval polled by a 120-minute cron skips every other tick.
 */
const DUE_GRACE_MS = 30_000;

export function isTickDue(
  lastRunAt: Date | null,
  intervalMinutes: number,
  now: Date
): boolean {
  if (lastRunAt === null) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalMinutes * 60_000 - DUE_GRACE_MS;
}

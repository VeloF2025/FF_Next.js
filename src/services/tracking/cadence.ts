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

/**
 * Allowed poll intervals, fastest first.
 *
 * Promotion is deliberately NOT automated. We are polling partner portals we do
 * not own, without their permission, so the only movement the system makes on
 * its own should be backwards. Tightening is a human running one UPDATE.
 */
export const RAMP_STEPS = [10, 30, 120] as const;

// Destructured at a fixed position rather than RAMP_STEPS[RAMP_STEPS.length -
// 1]: noUncheckedIndexedAccess (tsconfig.json) can't prove a computed index is
// in bounds, but a fixed-position destructure of a 3-element tuple is exact.
const [, , SLOWEST] = RAMP_STEPS;

/** The next slower interval. Unrecognised values snap to the slowest. */
export function demote(current: number): number {
  const i = RAMP_STEPS.indexOf(current as (typeof RAMP_STEPS)[number]);
  const nextIndex = i === -1 ? RAMP_STEPS.length - 1 : Math.min(i + 1, RAMP_STEPS.length - 1);
  // nextIndex is always within [0, RAMP_STEPS.length - 1]; the fallback only
  // satisfies noUncheckedIndexedAccess, it is never actually reached.
  return RAMP_STEPS[nextIndex] ?? SLOWEST;
}

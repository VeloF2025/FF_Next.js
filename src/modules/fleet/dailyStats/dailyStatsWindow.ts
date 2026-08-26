/**
 * Where a vehicle's rebuild window opens and closes, and which of its days are finished.
 *
 * Pure arithmetic over instants and day strings -- no database, no clock, no fold. Split out of
 * `dailyStatsBuildService` for the same reason PR1 split `dayWindow` out of `dayFold`: these are
 * the parts with a right answer independent of any loop, and they are the parts a reader has to
 * be able to check by eye.
 */
import { LATE_ARRIVAL_LOOKBACK_MINUTES } from './dailyStatsRepository';
import { dayStartMs, sastDay } from './dayIntervals';
import type { VehicleDayStats } from './types';

const MS_PER_DAY = 86_400_000;

/**
 * Where this vehicle's window opens: the earlier of the lookback floor and yesterday's midnight,
 * each snapped to a SAST day boundary. Null means the vehicle has never been built -- read
 * everything.
 */
export function windowStartFor(watermark: string | null, nowMs: number): string | null {
  if (watermark === null) return null;
  const parsed = Date.parse(watermark);
  if (!Number.isFinite(parsed)) return null;
  const floorMs = parsed - LATE_ARRIVAL_LOOKBACK_MINUTES * 60_000;
  const fromWatermarkMs = dayStartMs(sastDay(floorMs));
  const yesterdayMs = dayStartMs(sastDay(nowMs - MS_PER_DAY));
  return new Date(Math.min(fromWatermarkMs, yesterdayMs)).toISOString();
}

/**
 * The instant the fold treats as the end of the window: the moment this run read.
 *
 * Nominally `min(now, the start of the day after the last day being rebuilt)`. The second term is
 * never the smaller one and is deliberately not computed here: a position is recorded in the past,
 * so the last day rebuilt is at most today and the day after it starts later than `now`. Where a
 * run IS rebuilding an older day the tighter bound still applies, inside the fold -- `tailGapMs`
 * takes `min(windowEnd, that day's own end)`, which is what judges a closed day on its full 24
 * hours whatever this returns. Computing it twice would put one rule in two places.
 */
export function windowEndFor(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

/**
 * Which of the folded days are finished enough to store.
 *
 * When the read drained, every day the window covered is as complete as it will get and all of
 * them are written. When the ceiling stopped us, the last day with positions is still open: it is
 * withheld along with anything after it, so no complete row is ever overwritten by a partial one.
 *
 * `lastWindowDay` closes the far edge and is set only for a caller-supplied window (PR9's
 * refold). The reads are INCLUSIVE at `windowEnd`, so a window ending at the next midnight also
 * returns the fix recorded exactly at it. Folding that fix is right -- it is the day's lead-OUT,
 * the mirror of the lead-in, and it measures the interval that closes the day. WRITING the sliver
 * of a row it opens on the following day is not: that day's complete row is already stored, and a
 * one-position replacement of it is the partial-over-complete overwrite this module exists to
 * prevent. Null (the derived window) keeps today writable, which is what the cron is for.
 */
export function daysReadyToWrite(
  days: readonly VehicleDayStats[], drained: boolean, firstWindowDay: string | null,
  lastWindowDay: string | null = null,
): VehicleDayStats[] {
  // Anything before the window opened is not this run's to write. The lead-in itself is not
  // counted as a position so it earns no row, but a TRIP that began before the window and closed
  // inside it apportions ignition time across the days it spans -- and a day whose only content
  // is that sliver would be upserted over the complete row already stored for it.
  const withinFloor = firstWindowDay === null
    ? [...days]
    : days.filter((d) => d.workDate >= firstWindowDay);
  const inWindow = lastWindowDay === null
    ? withinFloor
    : withinFloor.filter((d) => d.workDate <= lastWindowDay);
  if (drained) return inWindow;
  const positionDays = inWindow.filter((d) => d.positionCount > 0).map((d) => d.workDate);
  const cutoff = positionDays[positionDays.length - 2];
  if (cutoff === undefined) return [];
  return inWindow.filter((d) => d.workDate <= cutoff);
}

/**
 * The newest day this run has definitely finished folding: every day it has touched except the
 * one it is still inside.
 *
 * Reads from the days seen at page edges, which can miss a day that never bounded a page. That
 * understates rather than overstates -- it returns an older day and the run keeps reading -- so
 * the ceiling stays conservative and the loop still terminates on the drain.
 */
export function lastClosedDay(daysTouched: ReadonlySet<string>): string | null {
  const sorted = [...daysTouched].sort();
  return sorted[sorted.length - 2] ?? null;
}

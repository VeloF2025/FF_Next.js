/**
 * The unobserved edges of a fold window.
 *
 * `tracker_silence_seconds` is built from the gaps BETWEEN observed fixes, which silently
 * over-rates the first and last day the fold emits: a vehicle whose first fix of the day lands at
 * 23:00 SAST has 23 hours nobody looked at, and every gap the fold can see is eight seconds. The
 * row then reports a two-minute largest silence and `coverage_complete = true` for a day it barely
 * witnessed.
 *
 * Interior days do not have this problem -- their head is the tail of the interval that crossed
 * midnight, which is already measured. Only the two edges of the window are unaccounted for, and
 * each has its own answer:
 *
 *   HEAD, first day with a position. The caller may supply a LEAD-IN: the last position before the
 *   window opened, whatever day it falls on. With it, the head is measured from that fix (or from
 *   midnight, whichever is later -- a lead-in on an earlier day tells us nothing about the hours
 *   after midnight). Without it, the fold has no evidence before its first fix and charges the
 *   whole head to silence.
 *
 *   TAIL, last day with a position. Bounded by `min(windowEnd, end of that day)`. A day that is
 *   still in progress is judged only up to the moment the fold ran; a day that has closed is
 *   judged on its full 24 hours, so a tracker that died at noon cannot be reported as a complete
 *   day.
 *
 * Both are pure arithmetic over instants supplied by the caller. Nothing here reads a clock.
 *
 * The caller's `windowEnd` is VALIDATED here rather than coerced. An unparseable string silently
 * becoming NaN would propagate through `Math.min` into `tracker_silence_seconds`, and NaN is not
 * storable in a `BIGINT NOT NULL` column -- so the fold would hand the build service a row that
 * fails on INSERT, one window after the mistake was made and nowhere near it. Failing at the
 * boundary names the caller's error instead.
 */
import { dayStartMs, MS_PER_DAY, sastDay } from './dayIntervals';

/**
 * The caller's window end as epoch ms, or null for "no claim about the tail".
 *
 * Only `null` and `undefined` mean the default. An empty string does NOT: the field is declared
 * `string | null`, so `''` is a caller passing a value it failed to build, and treating it as
 * "no window end" would quietly re-enable the over-rating this module exists to stop.
 */
export function parseWindowEnd(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`dayFold: unparseable windowEnd ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * A window that closes before its own last fix is a caller error, not a zero-length tail.
 *
 * Clamping it to zero would hide a mis-built window -- the exact case where the tail gap is most
 * needed -- so it is refused with the two instants named.
 */
export function assertWindowCoversLastFix(windowEndMs: number | null, lastFixMs: number): void {
  if (windowEndMs === null || windowEndMs >= lastFixMs) return;
  throw new Error(
    `dayFold: windowEnd ${new Date(windowEndMs).toISOString()} is before the last fix `
    + `${new Date(lastFixMs).toISOString()}`,
  );
}

/** The head and tail gaps for a window, with the days they belong to. */
export interface WindowEdges {
  firstDay: string;
  headMs: number;
  lastDay: string;
  tailMs: number;
}

/**
 * Both edges at once, anchored on the first and last POSITION.
 *
 * Never on the first and last emitted day: a day that exists only because a trip crossed into it
 * was not observed by this fold at all, and giving it a head gap would be inventing a measurement
 * about a date the positions never reached.
 */
export function windowEdges(
  firstFixMs: number,
  lastFixMs: number,
  leadInMs: number | null,
  windowEndMs: number | null,
): WindowEdges {
  const firstDay = sastDay(firstFixMs);
  const lastDay = sastDay(lastFixMs);
  return {
    firstDay,
    headMs: headGapMs(firstFixMs, dayStartMs(firstDay), leadInMs),
    lastDay,
    tailMs: tailGapMs(lastFixMs, dayStartMs(lastDay) + MS_PER_DAY, windowEndMs ?? lastFixMs),
  };
}

/** Milliseconds of the first emitted day that nobody observed before its first fix. */
export function headGapMs(
  firstFixMs: number,
  dayStartMs: number,
  leadInMs: number | null,
): number {
  // A lead-in from an earlier day says nothing about this day's small hours, so midnight still
  // bounds the claim. `Math.max` is what keeps that honest in both directions.
  const observedFrom = leadInMs === null ? dayStartMs : Math.max(dayStartMs, leadInMs);
  return Math.max(0, firstFixMs - observedFrom);
}

/** Milliseconds of the last emitted day that nobody observed after its last fix. */
export function tailGapMs(
  lastFixMs: number,
  dayEndMs: number,
  windowEndMs: number,
): number {
  return Math.max(0, Math.min(windowEndMs, dayEndMs) - lastFixMs);
}

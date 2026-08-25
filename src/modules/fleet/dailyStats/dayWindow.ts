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
 */

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

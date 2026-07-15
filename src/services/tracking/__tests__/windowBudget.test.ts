/**
 * The query window must fit the provider's event budget.
 *
 * Cartrack's feed is account-wide, so events scale with the active fleet. The
 * numbers below are not invented: measured against the live Velocity account
 * on 2026-07-15, the feed emits ~200 events/hour/vehicle (consistent across
 * 10min/30min/1h/6h probes), against a 20,000-event budget
 * (MAX_PAGES=20 x PAGE_SIZE=1000).
 *
 * That makes the 6h cold start cost roughly:
 *   7 vehicles  ->  ~8,400  (fits)
 *   22 vehicles -> ~26,400  (over budget -> fetchPositions throws)
 *   37 vehicles -> ~44,400  (over budget -> throws)
 *
 * A throw leaves the watermark unset, so the next tick cold-starts and throws
 * again: the poller never starts. These tests pin the clamp that prevents it.
 */
import { describe, it, expect } from 'vitest';
import { maxWindowMsFor, clampWindowStart, resolveWindow, COLD_START_MS } from '../windowBudget';
import { CARTRACK_MAX_EVENTS_PER_FETCH } from '../cartrack/provider';

/**
 * Imported, not hardcoded: if MAX_PAGES or PAGE_SIZE ever change, these tests
 * must re-evaluate against the new budget rather than keep passing against a
 * stale 20,000 that no longer describes the provider.
 */
const BUDGET = CARTRACK_MAX_EVENTS_PER_FETCH;
const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-07-15T12:00:00.000Z');

/** What the window would actually cost, at the rate measured on the live account. */
function estimatedEvents(windowMs: number, vehicles: number): number {
  return (windowMs / HOUR) * 200 * vehicles;
}

describe('maxWindowMsFor', () => {
  it('allows the full 6h cold start at the current fleet size (7 tracked)', () => {
    const w = maxWindowMsFor(BUDGET, 7);
    expect(w).toBeGreaterThanOrEqual(6 * HOUR);
    // Sanity: 6h at 7 vehicles really is affordable, so the clamp must not bite.
    expect(estimatedEvents(6 * HOUR, 7)).toBeLessThan(BUDGET);
  });

  it('shrinks the window as the fleet grows', () => {
    expect(maxWindowMsFor(BUDGET, 22)).toBeLessThan(maxWindowMsFor(BUDGET, 7));
    expect(maxWindowMsFor(BUDGET, 37)).toBeLessThan(maxWindowMsFor(BUDGET, 22));
  });

  it.each([
    ['22 vehicles', 22],
    ['37 vehicles', 37],
  ])('keeps the window inside the real event budget at %s', (_label, vehicles) => {
    const w = maxWindowMsFor(BUDGET, vehicles);
    expect(estimatedEvents(w, vehicles)).toBeLessThanOrEqual(BUDGET);
  });

  it('never plans a window narrower than the 5-minute floor', () => {
    // A fleet this size has outgrown one account-wide poll; the floor makes
    // that fail visibly rather than shrinking the window to nothing.
    expect(maxWindowMsFor(BUDGET, 100_000)).toBe(5 * 60 * 1000);
  });

  it('falls back to the cold-start width when no trackers are active', () => {
    // Nothing is reporting, so there are no events to page through.
    expect(maxWindowMsFor(BUDGET, 0)).toBe(COLD_START_MS);
  });

  it.each([
    ['budget NaN', NaN, 10],
    ['budget zero', 0, 10],
    ['budget negative', -1, 10],
    ['trackers NaN', 20_000, NaN],
    ['trackers negative', 20_000, -5],
  ])('never returns a non-finite window (%s)', (_label, budget, trackers) => {
    // Math.max(NaN, x) is NaN, and a NaN window would sail through the clamp as
    // an Invalid Date, reach fetchPositions as a corrupt request, and — since
    // clampedMs would also be NaN — skip the "we clamped" warning entirely.
    // Unreachable via cartrackProvider today; the guard is for the next one.
    const w = maxWindowMsFor(budget, trackers);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });
});

describe('resolveWindow', () => {
  it('warm start: overlaps back from the watermark when affordable', () => {
    const last = new Date(NOW.getTime() - 5 * 60 * 1000);
    const { from, clampedMs } = resolveWindow({
      last, now: NOW, maxEventsPerFetch: BUDGET, activeTrackers: 7,
    });
    expect(from).toEqual(new Date(last.getTime() - 30 * 60 * 1000)); // OVERLAP_MS
    expect(clampedMs).toBe(0);
  });

  it('cold start: backfills the full window at a small fleet', () => {
    const { from, clampedMs } = resolveWindow({
      last: null, now: NOW, maxEventsPerFetch: BUDGET, activeTrackers: 7,
    });
    expect(NOW.getTime() - from.getTime()).toBe(COLD_START_MS);
    expect(clampedMs).toBe(0);
  });

  it('cold start: clamps at a fleet that cannot afford it', () => {
    const { from, clampedMs, maxWindowMs } = resolveWindow({
      last: null, now: NOW, maxEventsPerFetch: BUDGET, activeTrackers: 22,
    });
    expect(clampedMs).toBeGreaterThan(0);
    expect(NOW.getTime() - from.getTime()).toBe(maxWindowMs);
    expect(estimatedEvents(NOW.getTime() - from.getTime(), 22)).toBeLessThanOrEqual(BUDGET);
  });

  it('never produces an inverted window (from after now)', () => {
    for (const trackers of [0, 1, 7, 22, 37, 100_000]) {
      const { from } = resolveWindow({
        last: null, now: NOW, maxEventsPerFetch: BUDGET, activeTrackers: trackers,
      });
      expect(from.getTime()).toBeLessThan(NOW.getTime());
    }
  });

  it('a stale watermark cannot drag the window past the budget', () => {
    // The watermark is days old (poller was down). Without the clamp this asks
    // for days of events at once and throws — the exact self-sustaining failure.
    const last = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    const { from, clampedMs } = resolveWindow({
      last, now: NOW, maxEventsPerFetch: BUDGET, activeTrackers: 22,
    });
    expect(clampedMs).toBeGreaterThan(0);
    expect(estimatedEvents(NOW.getTime() - from.getTime(), 22)).toBeLessThanOrEqual(BUDGET);
  });
});

describe('clampWindowStart', () => {
  it('leaves an affordable window untouched', () => {
    const desired = new Date(NOW.getTime() - 30 * 60 * 1000);
    const { from, clampedMs } = clampWindowStart(desired, NOW, 6 * HOUR);
    expect(from).toEqual(desired);
    expect(clampedMs).toBe(0);
  });

  it('pulls an over-budget start forward and reports what was given up', () => {
    const desired = new Date(NOW.getTime() - 6 * HOUR);
    const { from, clampedMs } = clampWindowStart(desired, NOW, 2 * HOUR);
    expect(from).toEqual(new Date(NOW.getTime() - 2 * HOUR));
    expect(clampedMs).toBe(4 * HOUR);
  });

  it('treats a start exactly on the floor as affordable', () => {
    const desired = new Date(NOW.getTime() - 2 * HOUR);
    const { from, clampedMs } = clampWindowStart(desired, NOW, 2 * HOUR);
    expect(from).toEqual(desired);
    expect(clampedMs).toBe(0);
  });
});

describe('the regression this guards: 6h cold start at 22 vehicles', () => {
  it('clamps the cold start to something the budget can actually pay for', () => {
    const desired = new Date(NOW.getTime() - 6 * HOUR); // COLD_START_MS
    const maxWindow = maxWindowMsFor(BUDGET, 22);
    const { from, clampedMs } = clampWindowStart(desired, NOW, maxWindow);

    // Unclamped this is ~26,400 events — over budget, so fetchPositions throws,
    // the watermark stays unset, and every subsequent tick repeats it.
    expect(estimatedEvents(6 * HOUR, 22)).toBeGreaterThan(BUDGET);

    // Clamped, the request fits and the poller can actually start.
    expect(clampedMs).toBeGreaterThan(0);
    expect(estimatedEvents(NOW.getTime() - from.getTime(), 22)).toBeLessThanOrEqual(BUDGET);
  });
});

/**
 * `prolonged_unauthorized_stop`.
 *
 * The cadence gate is the point of most of this file. Eleven of eighteen
 * tracked vehicles report every 10–35 minutes, and two stationary fixes 45
 * minutes apart are indistinguishable from a vehicle that drove away and came
 * back — so the snapshot feeds must produce NOTHING here, not something
 * plausible.
 *
 * The place lookup is injected; no PostGIS is involved.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DENSE_FEED_MAX_MEDIAN_GAP_SECONDS, detectUnauthorizedStops, findProlongedStops, medianGapSeconds,
} from '../unauthorizedStopDetector';
import { RULE, VEHICLE_ID, context, latOffset, position, series } from './detectorFixtures';

const START = '2026-08-18T08:00:00.000Z';
const nowhere = vi.fn(async () => null);

/** A dense (8 s) stationary hour with the engine running: the cartrack/velocity shape. */
function idleHour(seconds = 3_600, gapSeconds = 8) {
  return series(START, Math.floor(seconds / gapSeconds) + 1, gapSeconds, () => ({
    ignition: true, speedKph: 0,
  }));
}

describe('medianGapSeconds', () => {
  it('measures the dense feed at its 8-second cadence', () => {
    expect(medianGapSeconds(series(START, 10, 8))).toBe(8);
  });

  it('is null for a single fix, which describes no cadence at all', () => {
    expect(medianGapSeconds([position()])).toBeNull();
  });
});

describe('detectUnauthorizedStops', () => {
  it('fires for an hour stopped with the ignition on, nowhere known', async () => {
    const events = await detectUnauthorizedStops(context({ positions: idleHour() }), nowhere);

    expect(events).toHaveLength(1);
    expect(events[0]?.occurredAt).toBe(START);
    expect(events[0]?.sourceEventId).toBe(`prolonged_unauthorized_stop:${VEHICLE_ID}:${START}`);
    expect(events[0]?.metadata.stoppedMinutes).toBe(60);
    expect(events[0]?.metadata.nearestPlaceDistanceMeters).toBeNull();
  });

  it('does NOT fire at a known site inside the rule radius', async () => {
    const atDepot = vi.fn(async () => ({
      id: 'p1', kind: 'parking' as const, label: 'Depot', distanceM: 12,
    }));

    expect(await detectUnauthorizedStops(context({ positions: idleHour() }), atDepot)).toEqual([]);
  });

  it('DOES fire for a known place further away than the rule radius', async () => {
    const farOff = vi.fn(async () => ({
      id: 'p1', kind: 'parking' as const, label: 'Depot', distanceM: 480,
    }));
    const ctx = context({ positions: idleHour(), rule: { ...RULE, knownSiteRadiusMeters: 200 } });

    expect(await detectUnauthorizedStops(ctx, farOff)).toHaveLength(1);
  });

  it('does NOT fire on a snapshot feed, however long the apparent stop', async () => {
    // Two fixes two hours apart, both stationary with the ignition on: the
    // netstar/ituran shape. The gap alone exceeds the 45-minute threshold.
    const snapshot = series(START, 3, 7_200, () => ({ ignition: true, speedKph: 0 }));

    expect(medianGapSeconds(snapshot)).toBeGreaterThan(DENSE_FEED_MAX_MEDIAN_GAP_SECONDS);
    expect(await detectUnauthorizedStops(context({ positions: snapshot }), nowhere)).toEqual([]);
  });

  it('does NOT fire below the rule threshold', async () => {
    const ctx = context({ positions: idleHour(30 * 60) });

    expect(await detectUnauthorizedStops(ctx, nowhere)).toEqual([]);
  });

  it('does NOT fire with the ignition off — a parked vehicle is not a stop', async () => {
    const parked = idleHour().map((p) => ({ ...p, ignition: false }));

    expect(await detectUnauthorizedStops(context({ positions: parked }), nowhere)).toEqual([]);
  });
});

describe('findProlongedStops', () => {
  it('breaks the run when the vehicle leaves the stop radius, and starts a new one', () => {
    const first = idleHour();
    const drivenAway = series('2026-08-18T09:00:08.000Z', 451, 8, () => ({
      ignition: true, speedKph: 0, lat: latOffset(-26.1, 900),
    }));

    const stops = findProlongedStops(context({ positions: [...first, ...drivenAway] }));

    expect(stops).toHaveLength(2);
    expect(stops[0]?.startedAt).toBe(START);
    expect(stops[1]?.startedAt).toBe('2026-08-18T09:00:08.000Z');
  });

  it('needs more than one fix — a lone fix describes no duration', () => {
    expect(findProlongedStops(context({ positions: [position()] }))).toEqual([]);
  });
});

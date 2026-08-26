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
    // The SAST DAY of the observed start, not the instant — see the sliding-window
    // suite at the foot of this file for why the instant cannot be the bucket.
    expect(events[0]?.sourceEventId).toBe(`prolonged_unauthorized_stop:${VEHICLE_ID}:2026-08-18`);
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

/**
 * The bucket must not move as the window slides.
 *
 * This is the round-2 blocker, reproduced first and then pinned: a stop older
 * than the 12-hour window is anchored on the window's own oldest fix, that fix
 * moves forward every tick, and bucketing on it minted a fresh `sourceEventId`
 * each time — four ticks over thirteen hours gave four ids, which at the real
 * five-minute cadence is twelve incidents an hour for one parked vehicle.
 */
describe('sourceEventId stability across a sliding window', () => {
  const WINDOW_HOURS = 12;
  const STOP_START = Date.parse('2026-08-18T04:00:00.000Z'); // 06:00 SAST

  /** Ignition-on, stationary, 8 s apart — the dense feed, for `hours` hours. */
  function parkedFor(hours: number) {
    return series(new Date(STOP_START).toISOString(), Math.floor((hours * 3600) / 8) + 1, 8, () => ({
      ignition: true, speedKph: 0,
    }));
  }

  /** Exactly what the service hands a detector at `nowIso`: the last 12 h of fixes. */
  function windowAt(all: ReturnType<typeof parkedFor>, nowIso: string) {
    const now = Date.parse(nowIso);
    const from = now - WINDOW_HOURS * 3_600_000;
    return all.filter((p) => {
      const at = Date.parse(p.recordedAt);
      return at >= from && at <= now;
    });
  }

  it('gives ONE id across four ticks spanning a 13-hour stop', async () => {
    const all = parkedFor(13);
    const ticks = [
      '2026-08-18T09:00:00.000Z', // stop start still inside the window
      '2026-08-18T13:00:00.000Z',
      '2026-08-18T16:00:00.000Z', // window edge has now overtaken the true start
      '2026-08-18T17:00:00.000Z',
    ];

    const ids: string[] = [];
    for (const now of ticks) {
      const events = await detectUnauthorizedStops(
        context({ positions: windowAt(all, now), now }), nowhere,
      );
      for (const event of events) ids.push(event.sourceEventId);
    }

    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(`prolonged_unauthorized_stop:${VEHICLE_ID}:2026-08-18`);
  });

  it('marks the clamped stop as a floor rather than reporting a shrinking duration', async () => {
    const all = parkedFor(13);
    const late = await detectUnauthorizedStops(
      context({ positions: windowAt(all, '2026-08-18T17:00:00.000Z'), now: '2026-08-18T17:00:00.000Z' }),
      nowhere,
    );

    expect(late[0]?.metadata.startClampedToWindow).toBe(true);
  });

  it('opens at most one per SAST day for a vehicle parked Friday to Monday', async () => {
    // 2026-08-21 is a Friday. 72 hours of continuous ignition-on stationary
    // fixes, ticked hourly — 72 ticks, four SAST days touched.
    const start = Date.parse('2026-08-21T08:00:00.000Z');
    const all = series(new Date(start).toISOString(), (72 * 3600) / 8 + 1, 8, () => ({
      ignition: true, speedKph: 0,
    }));

    const ids = new Set<string>();
    for (let hour = 1; hour <= 72; hour += 1) {
      const now = new Date(start + hour * 3_600_000).toISOString();
      const events = await detectUnauthorizedStops(context({ positions: windowAt(all, now), now }), nowhere);
      for (const event of events) ids.add(event.sourceEventId);
    }

    // At most one per SAST calendar day, and here exactly three across 72 hourly
    // ticks — not 72. Three rather than four because the bucket is the day of the
    // OBSERVED start, which is the window's oldest fix and therefore lags the
    // current day by up to 12 h: the Monday ticks still see a Sunday-night
    // anchor. The days are named so a change in granularity fails here rather
    // than quietly multiplying incidents.
    expect([...ids].sort()).toEqual([
      `prolonged_unauthorized_stop:${VEHICLE_ID}:2026-08-21`,
      `prolonged_unauthorized_stop:${VEHICLE_ID}:2026-08-22`,
      `prolonged_unauthorized_stop:${VEHICLE_ID}:2026-08-23`,
    ]);
  });

  it('deduplicates two separate stops on one day — the documented cost of a stable key', async () => {
    const morning = series('2026-08-18T04:00:00.000Z', 451, 8, () => ({ ignition: true, speedKph: 0 }));
    const afternoon = series('2026-08-18T10:00:00.000Z', 451, 8, () => ({
      ignition: true, speedKph: 0, lat: latOffset(-26.1, 5_000),
    }));

    const events = await detectUnauthorizedStops(
      context({ positions: [...morning, ...afternoon], now: '2026-08-18T11:00:00.000Z' }), nowhere,
    );

    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.sourceEventId)).size).toBe(1);
  });
});

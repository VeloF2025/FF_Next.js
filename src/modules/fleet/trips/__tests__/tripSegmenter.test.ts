/**
 * Trip segmentation.
 *
 * The failure this file exists to prevent is the phantom trip: an ignition-on whose off-event was
 * never observed, silently becoming a 42-hour journey that poisons utilisation, average trip
 * length and cost-per-km while looking entirely plausible. Every fixture below is chosen so a
 * broken implementation produces a DIFFERENT answer, not merely a less tidy one.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENT_OPTIONS, segmentTrips,
  type SegmentOptions, type TripPosition,
} from '../tripSegmenter';

const NOW = '2026-08-01T18:00:00.000Z';
const OPTS: SegmentOptions = { ...DEFAULT_SEGMENT_OPTIONS, now: NOW };

/** Depot, and a point ~1.11 km north of it. */
const DEPOT = { lat: -26.2000, lon: 28.0000 };
const NORTH = { lat: -26.1900, lon: 28.0000 };

function p(
  time: string,
  ignition: boolean | null,
  over: Partial<TripPosition> = {},
): TripPosition {
  return {
    recordedAt: `2026-08-01T${time}:00.000Z`,
    ignition,
    lat: DEPOT.lat,
    lon: DEPOT.lon,
    speedKph: 0,
    odometerKm: null,
    ...over,
  };
}

describe('segmentTrips', () => {
  describe('the phantom-trip guard', () => {
    it('closes a silent trip at its LAST KNOWN position, never at now', () => {
      // Ignition on at 06:00, one fix at 06:30, then the tracker goes dark for 11.5 hours.
      const trips = segmentTrips([
        p('06:00', true),
        p('06:30', true, { lat: NORTH.lat, lon: NORTH.lon }),
      ], OPTS).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.closeReason).toBe('timeout');
      // The trip ended where it was last seen — 06:30 — NOT at 18:00.
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T06:30:00.000Z');
      expect(trips[0]?.durationSeconds).toBe(1800);
      expect(trips[0]?.offLat).toBe(NORTH.lat);
    });

    it('does not let a mid-stream gap swallow the following trip', () => {
      // 06:00 on, 06:10 fix, then 42 hours of silence, then a genuine 09:00 trip the next days.
      const trips = segmentTrips([
        p('06:00', true), p('06:10', true),
        { ...p('06:10', true), recordedAt: '2026-08-03T00:10:00.000Z' },
        { ...p('06:10', false), recordedAt: '2026-08-03T00:40:00.000Z' },
      ], { ...OPTS, now: '2026-08-03T02:00:00.000Z' }).trips;

      expect(trips).toHaveLength(2);
      expect(trips[0]?.closeReason).toBe('timeout');
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T06:10:00.000Z');
      // The second trip is a real one and must not have absorbed the 42-hour gap.
      expect(trips[1]?.closeReason).toBe('ignition_off');
      expect(trips[1]?.durationSeconds).toBe(1800);
    });

    it('marks a still-running trip open rather than inventing an end', () => {
      const trips = segmentTrips([
        { ...p('06:00', true), recordedAt: '2026-08-01T17:30:00.000Z' },
        { ...p('06:00', true), recordedAt: '2026-08-01T17:50:00.000Z' },
      ], OPTS).trips;

      expect(trips[0]?.closeReason).toBe('open');
      expect(trips[0]?.ignitionOffAt).toBeNull();
      expect(trips[0]?.offLat).toBeNull();
    });

    it('distinguishes a genuine end from a timeout of identical shape', () => {
      // Same two positions; the only difference is the final ignition state.
      const genuine = segmentTrips([p('06:00', true), p('06:30', false)], OPTS).trips;
      const silent = segmentTrips([p('06:00', true), p('06:30', true)], OPTS).trips;

      expect(genuine[0]?.closeReason).toBe('ignition_off');
      expect(silent[0]?.closeReason).toBe('timeout');
      // Both end at the same instant — the reason is the ONLY thing separating them, which is
      // exactly why it must be recorded rather than inferred later.
      expect(genuine[0]?.ignitionOffAt).toBe(silent[0]?.ignitionOffAt);
    });
  });

  describe('ignition transitions', () => {
    it('opens on false→true and closes on true→false', () => {
      const trips = segmentTrips([
        p('05:50', false), p('06:00', true), p('06:30', true), p('07:00', false),
      ], OPTS).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.ignitionOnAt).toBe('2026-08-01T06:00:00.000Z');
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T07:00:00.000Z');
      expect(trips[0]?.closeReason).toBe('ignition_off');
      expect(trips[0]?.positionCount).toBe(3);
    });

    it('treats consecutive ignition-true as ONE trip, not many', () => {
      // Cartrack samples every few seconds while running. If each true opened a trip we would
      // manufacture one per sample.
      const trips = segmentTrips([
        p('06:00', true), p('06:01', true), p('06:02', true), p('06:03', true), p('06:04', false),
      ], OPTS).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.positionCount).toBe(5);
    });

    it('ignores ignition-false while nothing is open', () => {
      const trips = segmentTrips([p('06:00', false), p('07:00', false)], OPTS).trips;
      expect(trips).toEqual([]);
    });

    it('separates two genuine trips in one day', () => {
      const trips = segmentTrips([
        p('06:00', true), p('07:00', false),
        p('12:00', true), p('13:00', false),
      ], OPTS).trips;

      expect(trips).toHaveLength(2);
      expect(trips.map((t) => t.closeReason)).toEqual(['ignition_off', 'ignition_off']);
      expect(trips[1]?.ignitionOnAt).toBe('2026-08-01T12:00:00.000Z');
    });
  });

  describe('null ignition', () => {
    it('never opens a trip on a null', () => {
      // ituran leaves ignition null on ~6% of rows. Inferring a boundary would manufacture trips.
      const trips = segmentTrips([p('06:00', null), p('07:00', null)], OPTS).trips;
      expect(trips).toEqual([]);
    });

    it('does NOT let a null ignition bridge a long silence into a counted trip', () => {
      // THE ORDERING BUG. When the staleness check sat AFTER the null branch, a null-ignition
      // position arriving on the far side of a 42-hour gap hit `continue` and never reached it —
      // so this produced ONE ignition_off trip of 152,400 seconds, marked metric-eligible. That
      // is exactly the phantom this whole module exists to prevent, and production has
      // null-ignition rows adjacent to multi-hour gaps today.
      const trips = segmentTrips([
        p('06:00', true),
        p('06:10', true),
        { ...p('06:10', null), recordedAt: '2026-08-03T00:10:00.000Z' },  // +42h, null
        { ...p('06:10', false), recordedAt: '2026-08-03T00:40:00.000Z' },
      ], { ...OPTS, now: '2026-08-03T02:00:00.000Z' }).trips;

      // The real 10-minute trip, closed as timeout where it was last seen.
      expect(trips[0]?.closeReason).toBe('timeout');
      expect(trips[0]?.durationSeconds).toBe(600);
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T06:10:00.000Z');

      // Nothing spanning the silence may be counted.
      const counted = trips.filter((t) => t.closeReason === 'ignition_off');
      expect(counted.every((t) => t.durationSeconds < 3600)).toBe(true);
      expect(trips.some((t) => t.durationSeconds > 100_000)).toBe(false);
    });

    it('checks staleness before deciding what a null ignition means', () => {
      // The same shape with the gap ENDING on a null: the trip must already be closed by the
      // timeout, so the null extends nothing.
      const trips = segmentTrips([
        p('06:00', true),
        { ...p('06:00', null), recordedAt: '2026-08-02T06:00:00.000Z' },   // +24h, null
      ], { ...OPTS, now: '2026-08-02T07:00:00.000Z' }).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.closeReason).toBe('timeout');
      expect(trips[0]?.durationSeconds).toBe(0);
      expect(trips[0]?.positionCount).toBe(1);
    });

    it('never closes a trip on a null, but still lets it accrue time', () => {
      const trips = segmentTrips([
        p('06:00', true), p('06:30', null), p('07:00', false),
      ], OPTS).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T07:00:00.000Z');
      expect(trips[0]?.positionCount).toBe(3);
    });
  });

  describe('measurements', () => {
    it('splits time into moving and idling by speed', () => {
      // Intervals kept inside the attribution ceiling — cartrack samples every ~1.7 min, so this
      // is the normal case. Longer gaps are deliberately NOT attributed; see the test below.
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 0 }),
        p('06:03', true, { speedKph: 60 }),   // 3 min moving
        p('06:06', true, { speedKph: 0 }),    // 3 min idling
        p('06:09', false, { speedKph: 0 }),   // 3 min idling
      ], OPTS).trips;

      expect(trips[0]?.movingSeconds).toBe(180);
      expect(trips[0]?.idleSeconds).toBe(360);
      // The schema refuses parts exceeding the whole; assert the same here.
      expect(trips[0]!.movingSeconds + trips[0]!.idleSeconds)
        .toBeLessThanOrEqual(trips[0]!.durationSeconds);
    });

    it('leaves a long gap UNATTRIBUTED rather than guessing which bucket it belongs to', () => {
      // ituran's median gap is 34 minutes. Attributing the whole interval by the speed of the fix
      // that CLOSES it would book half an hour of driving as idling merely because the vehicle
      // happened to be at rest when the next fix landed. The uncertainty belongs in
      // duration - (moving + idle), not in a confident split.
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 80 }),
        p('06:34', true, { speedKph: 0 }),    // 34 min gap, ends at rest
        p('06:35', false, { speedKph: 0 }),   // 1 min, attributable
      ], OPTS).trips;

      expect(trips[0]?.durationSeconds).toBe(2100);
      expect(trips[0]?.idleSeconds).toBe(60);      // only the short interval
      expect(trips[0]?.movingSeconds).toBe(0);
      // 2040 seconds are counted in the trip but attributed to neither bucket.
      const unattributed = trips[0]!.durationSeconds - trips[0]!.movingSeconds - trips[0]!.idleSeconds;
      expect(unattributed).toBe(2040);
    });

    it('treats an unreported speed as unknown, not as stationary', () => {
      // `speedKph ?? 0` conflated "the tracker did not say" with "the vehicle was still".
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 60 }),
        p('06:02', true, { speedKph: null }),
        p('06:03', false, { speedKph: 0 }),
      ], OPTS).trips;

      expect(trips[0]?.idleSeconds).toBe(60);   // the last minute only
      expect(trips[0]?.movingSeconds).toBe(0);
    });

    it('accrues distance between fixes', () => {
      const trips = segmentTrips([
        p('06:00', true),
        p('06:30', true, { lat: NORTH.lat, lon: NORTH.lon, speedKph: 60 }),
        p('07:00', false, { lat: NORTH.lat, lon: NORTH.lon }),
      ], OPTS).trips;

      // 0.01 degrees of latitude is ~1.11 km.
      expect(trips[0]?.distanceKm).toBeGreaterThan(1.0);
      expect(trips[0]?.distanceKm).toBeLessThan(1.2);
    });

    it('keeps the highest speed seen', () => {
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 20 }),
        p('06:10', true, { speedKph: 95 }),
        p('06:20', false, { speedKph: 10 }),
      ], OPTS).trips;
      expect(trips[0]?.maxSpeedKph).toBe(95);
    });

    it('drops an odometer pair that runs backwards rather than storing a negative journey', () => {
      const trips = segmentTrips([
        p('06:00', true, { odometerKm: 5000 }),
        p('07:00', false, { odometerKm: 4000 }),
      ], OPTS).trips;

      expect(trips[0]?.startOdometerKm).toBeNull();
      expect(trips[0]?.endOdometerKm).toBeNull();
    });

    it('keeps a forward odometer pair', () => {
      const trips = segmentTrips([
        p('06:00', true, { odometerKm: 5000 }),
        p('07:00', false, { odometerKm: 5042 }),
      ], OPTS).trips;

      expect(trips[0]?.startOdometerKm).toBe(5000);
      expect(trips[0]?.endOdometerKm).toBe(5042);
    });

    it('advances time through a position that lost its GPS fix', () => {
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 60 }),
        p('06:03', true, { lat: null, lon: null, speedKph: 60 }),
        p('06:06', false, { speedKph: 0 }),
      ], OPTS).trips;

      // Losing a fix is not the same as standing still: the clock keeps running.
      expect(trips[0]?.durationSeconds).toBe(360);
      expect(trips[0]?.movingSeconds).toBe(180);
    });
  });

  describe('no carried state', () => {
    it('takes no carry: a window is recomputed from its own positions', () => {
      // The previous design threaded the last open trip back in and reconstructed it lossily —
      // re-anchoring its last-seen position to its START, which collapsed duration to zero while
      // moving time survived, violating the table's CHECK and stalling that vehicle for good.
      // segmentTrips now has arity 2; there is nothing to reconstruct.
      expect(segmentTrips.length).toBe(2);
    });

    it('computes a whole journey when given the whole journey', () => {
      const trips = segmentTrips([
        p('06:00', true, { speedKph: 60 }),
        p('06:02', true, { speedKph: 60 }),
        p('06:04', true, { speedKph: 60 }),
        p('06:06', false, { speedKph: 0 }),
      ], OPTS).trips;

      expect(trips).toHaveLength(1);
      expect(trips[0]?.ignitionOnAt).toBe('2026-08-01T06:00:00.000Z');
      expect(trips[0]?.ignitionOffAt).toBe('2026-08-01T06:06:00.000Z');
      expect(trips[0]?.durationSeconds).toBe(360);
      // The invariant the old carry broke.
      expect(trips[0]!.movingSeconds + trips[0]!.idleSeconds)
        .toBeLessThanOrEqual(trips[0]!.durationSeconds);
    });

    it('is deterministic — the same input twice gives byte-identical output', () => {
      const input = [p('06:00', true), p('06:03', true, { speedKph: 40 }), p('06:06', false)];
      expect(JSON.stringify(segmentTrips(input, OPTS)))
        .toBe(JSON.stringify(segmentTrips(input, OPTS)));
    });

    it('reports the newest position consumed, for the watermark', () => {
      const result = segmentTrips([p('06:00', true), p('07:00', false)], OPTS);
      expect(result.lastPositionAt).toBe('2026-08-01T07:00:00.000Z');
      expect(segmentTrips([], OPTS).lastPositionAt).toBeNull();
    });
  });

  it('produces nothing from no positions', () => {
    expect(segmentTrips([], OPTS).trips).toEqual([]);
  });

  it('never emits a trip the schema would refuse', () => {
    const trips = segmentTrips([
      p('06:00', true, { speedKph: 30, odometerKm: 100 }),
      p('06:30', null, { speedKph: 0 }),
      p('07:00', false, { speedKph: 0, odometerKm: 130 }),
      p('12:00', true, { speedKph: 50 }),
    ], OPTS).trips;

    expect(trips.length).toBeGreaterThan(0);
    for (const t of trips) {
      expect((t.ignitionOffAt === null)).toBe(t.closeReason === 'open');
      if (t.ignitionOffAt) expect(Date.parse(t.ignitionOffAt)).toBeGreaterThanOrEqual(Date.parse(t.ignitionOnAt));
      expect(t.durationSeconds).toBeGreaterThanOrEqual(0);
      expect(t.distanceKm).toBeGreaterThanOrEqual(0);
      expect(t.movingSeconds + t.idleSeconds).toBeLessThanOrEqual(t.durationSeconds);
      expect((t.onLat === null)).toBe(t.onLon === null);
      expect((t.offLat === null)).toBe(t.offLon === null);
    }
  });
});

/**
 * Fold correctness for one vehicle's day.
 *
 * The fold's output is a row that will pass every CHECK migration 528 declares whether it is right
 * or wrong -- a distance understated by 4% and an idle bucket that swallowed unknown time both
 * look exactly like a good day. So these cases assert the arithmetic against fixtures whose
 * answers were computed by hand, not against the fold's own opinion of itself.
 */
import { describe, expect, it } from 'vitest';
import { foldVehicleDays } from '../dayFold';
import { fix, ituranDayWithLongSilence, netstarDay, urentDay, velocityRun } from './fixtures';

/** 06:00 SAST on 2026-08-10, well clear of both midnights. */
const MORNING = '2026-08-10T04:00:00.000Z';

describe('distance', () => {
  it('uses the odometer delta when the odometer is present and monotonic', () => {
    // 30 fixes, 8 s apart, all at 90 km/h: 29 intervals x 8 s x 90 km/h = 5.8 km.
    const [day] = foldVehicleDays(velocityRun(MORNING, 30, [90]));
    expect(day!.distanceKm).toBeCloseTo(5.8, 2);
  });

  it('falls back to haversine when the feed supplies no odometer at all', () => {
    // netstar/europcar has no odometer column. Nine 0.01-degree steps east at -26.2041.
    const [day] = foldVehicleDays(netstarDay(MORNING));
    // 0.01 deg of longitude at this latitude is ~0.9977 km; nine of them is ~8.98 km.
    expect(day!.distanceKm).toBeGreaterThan(8.5);
    expect(day!.distanceKm).toBeLessThan(9.5);
  });

  it('falls back to haversine for the one interval whose odometer ran backwards', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 60, odometerKm: 100, lat: -26.2, lon: 28.0 }),
      // A bad reading: the odometer cannot run backwards. Distance for this interval must come
      // from the coordinates instead of being dropped or recorded as a negative journey.
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 60, odometerKm: 20, lat: -26.2, lon: 28.01 }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.distanceKm).toBeGreaterThan(0.9);
    expect(day!.distanceKm).toBeLessThan(1.1);
  });

  it('records no distance at all when neither an odometer nor coordinates are available', () => {
    const positions = [
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 0, ignition: true, speedKph: 40 }),
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 60, ignition: true, speedKph: 40 }),
    ];
    expect(foldVehicleDays(positions)[0]!.distanceKm).toBe(0);
  });
});

describe('idle and moving', () => {
  it('books an interval as idle only when ignition is on and the speed is exactly zero', () => {
    // 11 fixes 8 s apart, all stationary with ignition on: 10 intervals x 8 s = 80 s of idling.
    const [day] = foldVehicleDays(velocityRun(MORNING, 11, [0]));
    expect(day!.idleSeconds).toBe(80);
    expect(day!.movingSeconds).toBe(0);
    expect(day!.ignitionSeconds).toBe(80);
  });

  it('books a moving interval at any speed above zero, however slow', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 11, [1]));
    expect(day!.movingSeconds).toBe(80);
    expect(day!.idleSeconds).toBe(0);
  });

  it('books neither bucket when ignition is off, so a parked day carries no ignition time', () => {
    const parked = Array.from({ length: 11 }, (_, i) => fix(MORNING, 'cartrack', 'velocity', {
      offsetSeconds: i * 8, ignition: false, speedKph: 0,
    }));
    const [day] = foldVehicleDays(parked);
    expect(day!.ignitionSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('leaves an unreported speed unattributed rather than calling it stationary', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 50 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: null }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.ignitionSeconds).toBe(60);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('refuses to attribute a gap longer than the attribution ceiling', () => {
    // urent's median gap is 1,797 s against a 300 s ceiling: almost nothing is attributable, and
    // inventing half an hour of idling from one stationary fix is exactly the fabrication the
    // ceiling exists to prevent.
    const [day] = foldVehicleDays(urentDay(MORNING, 4));
    expect(day!.movingSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.ignitionSeconds).toBe(0);
  });

  it('prefers the provider IDLING_START/END boundary events over the sampled speed', () => {
    // Cartrack's firmware states the boundary exactly. Between IDLING_START and IDLING_END the
    // period is idling even though these fixes report a non-zero speed, which sampled speed alone
    // would have booked as moving.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 3, providerEventType: 'IDLING_START' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 3, providerEventType: 'IDLING_CONTINUE' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 120, ignition: true, speedKph: 3, providerEventType: 'IDLING_END' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 180, ignition: true, speedKph: 3, providerEventType: 'PERIODIC_EVENT' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.idleSeconds).toBe(120);
    expect(day!.movingSeconds).toBe(60);
  });

  it('prefers MOTION_START/END over a zero sampled speed', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0, providerEventType: 'MOTION_START' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 0, providerEventType: 'MOTION_END' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 120, ignition: true, speedKph: 0, providerEventType: 'PERIODIC_EVENT' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.movingSeconds).toBe(60);
    expect(day!.idleSeconds).toBe(60);
  });
});

describe('tracker silence', () => {
  it('reports the LARGEST gap, never the sum of gaps', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 600, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 1_500, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 1_800, ignition: true, speedKph: 0 }),
    ];
    const [day] = foldVehicleDays(positions);
    // Gaps are 600, 900, 300. The sum is 1,800 -- which is what a `+=` would report.
    expect(day!.trackerSilenceSeconds).toBe(900);
  });

  it('splits a silence that crosses midnight across both days rather than double-counting it', () => {
    const days = foldVehicleDays(ituranDayWithLongSilence(MORNING));
    // A 42-hour silence starting at 08:54 SAST spans the rest of that day, all of the next, and
    // part of the one after. No single day may claim the whole 42 hours.
    for (const day of days) {
      expect(day.trackerSilenceSeconds).toBeLessThanOrEqual(86_400);
    }
    expect(Math.max(...days.map((d) => d.trackerSilenceSeconds))).toBe(86_400);
  });
});

describe('max speed', () => {
  it('is null when no fix in the day carried a speed', () => {
    const positions = [
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 0, ignition: true }),
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 60, ignition: true }),
    ];
    expect(foldVehicleDays(positions)[0]!.maxSpeedKph).toBeNull();
  });

  it('is the largest speed observed, not the last one', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 6, [40, 110, 60]));
    expect(day!.maxSpeedKph).toBe(110);
  });
});

describe('speeding', () => {
  it('counts a rising edge once, not once per fix inside it', () => {
    const speeding = [false, true, true, true, false, true].map((isSpeeding, i) => fix(
      MORNING, 'cartrack', 'velocity',
      { offsetSeconds: i * 8, ignition: true, speedKph: 130, isSpeeding },
    ));
    const [day] = foldVehicleDays(speeding);
    expect(day!.speedingEvents).toBe(2);
    // Four intervals close on a speeding fix (indices 1, 2, 3 and 5), at 8 s each.
    expect(day!.speedingSeconds).toBe(32);
  });
});

describe('ignition instants', () => {
  it('records the first and last fix that asserted ignition, and nulls both when none did', () => {
    const [driven] = foldVehicleDays(velocityRun(MORNING, 4, [50]));
    expect(driven!.firstIgnitionAt).toBe('2026-08-10T04:00:00.000Z');
    expect(driven!.lastIgnitionAt).toBe('2026-08-10T04:00:24.000Z');

    const parked = foldVehicleDays([
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: false, speedKph: 0 }),
    ]);
    expect(parked[0]!.firstIgnitionAt).toBeNull();
    expect(parked[0]!.lastIgnitionAt).toBeNull();
  });
});

describe('harsh events', () => {
  it('counts the provider HARSH_* event above the minimum speed gate', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 110, providerEventType: 'HARSH_CORNERING' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, ignition: true, speedKph: 95, providerEventType: 'HARSH_BRAKING' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.harshCornerEvents).toBe(1);
    expect(day!.harshBrakeEvents).toBe(1);
    expect(day!.coverageProviderEvents).toBe(true);
  });

  it('discards the provider HARSH_* event below the speed gate, because that is a device artefact', () => {
    // Every live HARSH_BRAKING sample carried speed = 6 km/h, and 19 of 20 g-derived braking
    // events on the only vehicle reporting g were at <= 10 km/h. That is the device, not driving.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 6, providerEventType: 'HARSH_BRAKING' }),
    ];
    expect(foldVehicleDays(positions)[0]!.harshBrakeEvents).toBe(0);
  });

  it('falls back to the g threshold on a vehicle-day that reports real g', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 80, linearG: -0.52, lateralG: 0.02 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, ignition: true, speedKph: 80, linearG: 0.01, lateralG: 0.47 }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.coverageGforce).toBe(true);
    expect(day!.harshBrakeEvents).toBe(1);
    expect(day!.harshCornerEvents).toBe(1);
  });

  it('stores no harsh count at all on a vehicle-day whose g columns are constant zero', () => {
    // The six-of-seven firmware family. Nothing here may reach the harsh counters, or migration
    // 528's harsh-requires-coverage CHECK would be satisfied by a fabrication.
    const [day] = foldVehicleDays(velocityRun(MORNING, 40, [80]).map((p) => ({ ...p, providerEventType: null })));
    expect(day!.coverageGforce).toBe(false);
    expect(day!.coverageProviderEvents).toBe(false);
    expect(day!.harshBrakeEvents + day!.harshAccelEvents + day!.harshCornerEvents).toBe(0);
  });
});

describe('the row migration 528 will accept', () => {
  it('never lets moving plus idle exceed ignition, on any fixture', () => {
    const fixtures = [
      velocityRun(MORNING, 200, [0, 40, 0, 90]),
      urentDay(MORNING),
      netstarDay(MORNING),
      ituranDayWithLongSilence(MORNING),
    ];
    for (const positions of fixtures) {
      for (const day of foldVehicleDays(positions)) {
        expect(day.movingSeconds + day.idleSeconds).toBeLessThanOrEqual(day.ignitionSeconds);
      }
    }
  });

  it('zeroes every ignition-derived second on a day that does not assert ignition', () => {
    // Below the 90% ratio: three of five fixes leave ignition null.
    const positions = [true, null, null, null, true].map((ignition, i) => fix(
      MORNING, 'ituran', 'avis', { offsetSeconds: i * 60, ignition, speedKph: 0, odometerKm: 10 + i },
    ));
    const [day] = foldVehicleDays(positions);
    expect(day!.coverageIgnition).toBe(false);
    expect(day!.ignitionSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('carries a source watermark whenever it folded a fix', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 5, [40]));
    expect(day!.positionCount).toBe(5);
    expect(day!.sourceWatermark).toBe('2026-08-10T04:00:32.000Z');
  });
});

describe('feed attribution', () => {
  it('names the feed that contributed the most fixes, and calls a two-kind day mixed', () => {
    const positions = [
      ...velocityRun(MORNING, 30, [40]),
      ...netstarDay(MORNING, 3),
    ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const [day] = foldVehicleDays(positions);
    expect(day!.provider).toBe('cartrack');
    expect(day!.accountRef).toBe('velocity');
    expect(day!.coverageGranularity).toBe('mixed');
  });
});

describe('input contract', () => {
  it('refuses positions that arrive out of order rather than mis-measuring the gaps', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0 }),
    ];
    expect(() => foldVehicleDays(positions)).toThrow(/ascending/i);
  });
});

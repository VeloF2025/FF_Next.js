/**
 * Vehicle-day rows shaped like the three feeds this fleet actually runs on.
 *
 * A trivially-full fixture would let every rendering rule pass by accident, so the sparse feeds
 * are modelled as measured: netstar/europcar asserts no ignition and reports no odometer, and the
 * cartrack family whose g columns are structurally zero still reports harsh events through the
 * provider vocabulary.
 */
import type { VehicleDayStatsRow } from '../../statsQueries';

export function cartrackDay(overrides: Partial<VehicleDayStatsRow> = {}): VehicleDayStatsRow {
  return {
    workDate: '2026-08-20',
    ignitionSeconds: 27_000, movingSeconds: 21_600, idleSeconds: 4_800,
    distanceKm: 143.25, maxSpeedKph: 118.4,
    speedingEvents: 3, speedingSeconds: 540,
    harshBrakeEvents: 2, harshAccelEvents: 0, harshCornerEvents: 1,
    firstIgnitionAt: '2026-08-20T04:10:00.000Z', lastIgnitionAt: '2026-08-20T15:00:00.000Z',
    positionCount: 1_169, trackerSilenceSeconds: 480,
    provider: 'cartrack', accountRef: 'velocity',
    coverageGranularity: 'history',
    coverageIgnition: true, coverageGforce: false, coverageProviderEvents: true,
    coverageComplete: true,
    sourceWatermark: '2026-08-20T21:59:00.000Z', computedAt: '2026-08-21T00:05:00.000Z',
    ...overrides,
  };
}

/** Ten fixes a day, no ignition assertion, no odometer: ignition/idle/moving are unmeasurable. */
export function netstarDay(overrides: Partial<VehicleDayStatsRow> = {}): VehicleDayStatsRow {
  return cartrackDay({
    workDate: '2026-08-21',
    ignitionSeconds: 0, movingSeconds: 0, idleSeconds: 0,
    distanceKm: 61.4, maxSpeedKph: 96.2,
    speedingEvents: 1, speedingSeconds: 0,
    harshBrakeEvents: 0, harshAccelEvents: 0, harshCornerEvents: 0,
    firstIgnitionAt: null, lastIgnitionAt: null,
    positionCount: 10, trackerSilenceSeconds: 7_200,
    provider: 'netstar', accountRef: 'europcar',
    coverageGranularity: 'snapshot',
    coverageIgnition: false, coverageGforce: false, coverageProviderEvents: false,
    coverageComplete: false,
    ...overrides,
  });
}

/**
 * Fixtures for the detector tests, built from MEASURED production shapes.
 *
 * The cadences here are not round numbers chosen for readability: PR0 measured
 * `cartrack/velocity` at a median 8-second gap (~1,169 fixes/vehicle-day) and
 * the three other feeds at 10–35 minutes. A fixture built at a convenient
 * 2-minute cadence would be off by ~15x for the dense feed and would let a
 * cadence gate pass that production fails, which is the whole reason
 * `prolonged_unauthorized_stop` and `lost_contact_moving` have one.
 */

import type {
  DetectorPosition, DetectorVehicle, VehicleDetectorContext, VehicleOperationalRule,
} from '../types';

export const VEHICLE_ID = 'a1a1a1a1-1111-4111-8111-111111111111';

/**
 * Migration 529's seeded version 1, field for field.
 *
 * The window is 21:00 -> 05:00, which is what 529 actually seeds — NOT the
 * 18:00 -> 06:00 the plan first proposed. PR4's dry run measured 9.14
 * theft events/day at 18:00 against 3.86 at 21:00, and the seed moved. A
 * fixture holding the old numbers would be a test of a rule nobody runs.
 */
export const RULE: VehicleOperationalRule = {
  id: 'rule-1', version: 1, timezone: 'Africa/Johannesburg',
  effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  afterHoursStartTime: '21:00:00', afterHoursEndTime: '05:00:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: true,
  theftDisplacementMeters: 500, theftMinPositions: 2,
  harshLinearG: 0.35, harshLateralG: 0.35, harshMinSpeedKph: 20, speedOverLimitKph: 15,
  unauthorizedStopMinutes: 45, lostContactMinutes: 30, idleAlertMinutes: 20,
  knownSiteRadiusMeters: 500, changeReason: null, createdBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

export const VEHICLE: DetectorVehicle = {
  vehicleId: VEHICLE_ID, registration: 'ABC 123 GP', afterHoursExempt: false,
};

/** A `cartrack/velocity` fix: every column populated, g structurally zero (6 of 7 vehicles). */
export function position(overrides: Partial<DetectorPosition> = {}): DetectorPosition {
  return {
    recordedAt: '2026-08-18T19:10:00.000Z',
    providerEventId: 'ct-1',
    provider: 'cartrack',
    accountRef: 'velocity',
    ignition: true,
    lat: -26.1,
    lon: 28.05,
    speedKph: 0,
    linearG: 0,
    lateralG: 0,
    providerEventType: 'PERIODIC_EVENT',
    ...overrides,
  };
}

/** `n` fixes `gapSeconds` apart from `startIso`, each shaped by `shape(index)`. */
export function series(
  startIso: string, n: number, gapSeconds: number,
  shape: (index: number) => Partial<DetectorPosition> = () => ({}),
): DetectorPosition[] {
  const start = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => position({
    recordedAt: new Date(start + i * gapSeconds * 1000).toISOString(),
    providerEventId: `ct-${i}`,
    ...shape(i),
  }));
}

export function context(overrides: Partial<VehicleDetectorContext> = {}): VehicleDetectorContext {
  return {
    vehicle: VEHICLE,
    positions: [],
    lastPosition: null,
    gapP90Seconds: 30,
    rule: RULE,
    holidays: new Set<string>(),
    now: '2026-08-18T19:00:00.000Z',
    ...overrides,
  };
}

/** ~0.001 degrees of latitude is ~111 m — enough to build a known displacement. */
export function latOffset(baseLat: number, meters: number): number {
  return baseLat + meters / 111_320;
}

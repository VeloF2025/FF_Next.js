/**
 * Position fixtures built from the four feed shapes actually present in production, measured on
 * 2026-08-25 over 30 days of `fleet_vehicle_positions`.
 *
 * Shared rather than re-declared per test file because the numbers are evidence, not convenience:
 * a fixture at "one fix a minute" would pass every test here and represent no vehicle we own.
 *
 *   cartrack/velocity  8 s median gap, ~1,169 fixes/day, ignition 100%, odometer yes, g on 1 of 7
 *   cartrack/urent     1,797 s median gap, 15 fixes/day, ignition 100%, odometer yes, no g
 *   netstar/europcar   637 s median gap, 10 fixes/day, ignition 100%, NO ODOMETER, no g
 *   ituran/avis        2,095 s median gap, 11 fixes/day, ignition 94.5%, odometer yes, no g
 */
import type { DayPosition } from '../types';

export interface FixSpec {
  offsetSeconds: number;
  providerEventId?: string | null;
  ignition?: boolean | null;
  speedKph?: number | null;
  isSpeeding?: boolean | null;
  odometerKm?: number | null;
  linearG?: number | null;
  lateralG?: number | null;
  providerEventType?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** Builds a fix at `offsetSeconds` after `startIso`, defaulting every unstated field to null. */
export function fix(
  startIso: string,
  provider: string,
  accountRef: string,
  spec: FixSpec,
): DayPosition {
  const recordedAt = new Date(Date.parse(startIso) + spec.offsetSeconds * 1000).toISOString();
  return {
    recordedAt,
    // Distinct per fix by default. Two fixes may legitimately share an instant, so the id is what
    // separates a real tie from the same fix arriving twice.
    providerEventId: spec.providerEventId === undefined
      ? `${provider}:${accountRef}:${recordedAt}`
      : spec.providerEventId,
    provider,
    accountRef,
    ignition: spec.ignition ?? null,
    lat: spec.lat ?? null,
    lon: spec.lon ?? null,
    speedKph: spec.speedKph ?? null,
    isSpeeding: spec.isSpeeding ?? null,
    odometerKm: spec.odometerKm ?? null,
    linearG: spec.linearG ?? null,
    lateralG: spec.lateralG ?? null,
    providerEventType: spec.providerEventType ?? null,
  };
}

/**
 * A `cartrack/velocity` run: one fix every 8 seconds, ignition asserted on every fix, odometer
 * present and monotonic, g columns constant zero (the six-of-seven firmware family).
 *
 * `speedKph` alternates through `speeds`, so a caller can build a stretch of idling by passing
 * `[0]` and a stretch of driving by passing something else.
 */
export function velocityRun(
  startIso: string,
  count: number,
  speeds: readonly number[],
  startOdometerKm = 10_000,
): DayPosition[] {
  let odometer = startOdometerKm;
  return Array.from({ length: count }, (_, i) => {
    const speedKph = speeds[i % speeds.length]!;
    // 8 s at v km/h, in km. Monotonic by construction, which is what the odometer branch needs.
    if (i > 0) odometer += (speeds[(i - 1) % speeds.length]! * 8) / 3600;
    return fix(startIso, 'cartrack', 'velocity', {
      offsetSeconds: i * 8,
      ignition: true,
      speedKph,
      isSpeeding: false,
      odometerKm: Math.round(odometer * 100) / 100,
      linearG: 0,
      lateralG: 0,
      providerEventType: 'PERIODIC_EVENT',
    });
  });
}

/** A `cartrack/urent` day: ~15 fixes at a 1,797 s median gap, odometer present, no g. */
export function urentDay(startIso: string, count = 15): DayPosition[] {
  let odometer = 55_000;
  return Array.from({ length: count }, (_, i) => {
    if (i > 0) odometer += 12.5;
    return fix(startIso, 'cartrack', 'urent', {
      offsetSeconds: i * 1_797,
      ignition: i % 3 !== 0,
      speedKph: i % 3 === 0 ? 0 : 62,
      isSpeeding: false,
      odometerKm: Math.round(odometer * 100) / 100,
    });
  });
}

/**
 * A `netstar/europcar` day: ~10 snapshot fixes at a 637 s gap, ignition on every fix, and NO
 * odometer at all -- so its distance has to come from haversine or not at all.
 *
 * The coordinates walk east along a fixed latitude, 0.01 degrees at a time.
 */
export function netstarDay(startIso: string, count = 10): DayPosition[] {
  return Array.from({ length: count }, (_, i) => fix(startIso, 'netstar', 'europcar', {
    offsetSeconds: i * 637,
    ignition: true,
    speedKph: i === 0 ? 0 : 48,
    isSpeeding: false,
    odometerKm: null,
    lat: -26.2041,
    lon: 28.0473 + i * 0.01,
  }));
}

/**
 * An `ituran/avis` day carrying the 42-hour silence that exists in production.
 *
 * Ituran asserts ignition on 94.5% of fixes, so one fix in this run leaves it null -- a null is
 * missing information, never "off".
 */
export function ituranDayWithLongSilence(startIso: string): DayPosition[] {
  const before = Array.from({ length: 6 }, (_, i) => fix(startIso, 'ituran', 'avis', {
    offsetSeconds: i * 2_095,
    ignition: i === 3 ? null : true,
    speedKph: i === 0 ? 0 : 71,
    isSpeeding: false,
    odometerKm: 88_000 + i * 40,
  }));
  // 42 hours after the last fix above. Deliberately crosses two SAST midnights.
  const gapStart = 5 * 2_095;
  const after = [
    fix(startIso, 'ituran', 'avis', {
      offsetSeconds: gapStart + 42 * 3_600,
      ignition: true,
      speedKph: 0,
      isSpeeding: false,
      odometerKm: 88_400,
    }),
  ];
  return [...before, ...after];
}

/**
 * A multi-day, multi-feed position fixture for the SERVICE-level tests.
 *
 * The cadence here is 240 s rather than the measured 8 s of `cartrack/velocity`. That is a
 * runtime concession and it is safe for what these tests prove: the batch sweep at size 1 reads
 * one row per query, so an honest 1,169-fix day would be ~1.2 million array scans per sweep. What
 * matters to the sweep is that a day holds many fixes, that batch boundaries fall INSIDE a day,
 * and that the gaps stay under the 300 s attribution ceiling so the ignition-derived columns are
 * non-zero and can therefore differ. The 8-second shape is exercised where it belongs, in
 * `dayFold`'s own suite.
 */
import type { FakePositionRow } from './fakeDb';

export const DAYS = ['2026-08-20', '2026-08-21', '2026-08-22'] as const;
/** Midnight SAST that opens each day, as epoch ms. */
export const dayStart = (workDate: string): number => Date.parse(`${workDate}T00:00:00+02:00`);

export const CADENCE_MS = 240_000;
export const FIXES_PER_DAY = 360;

export const ALPHA = 'v-alpha';
export const BETA = 'v-beta';

/** The instant the twin pair shares, on the middle day. */
export const TWIN_AT = new Date(dayStart(DAYS[1]) + CADENCE_MS * 100).toISOString();

function alphaFix(i: number, atMs: number, suffix = ''): FakePositionRow {
  const driving = i % 360 >= 60 && i % 360 < 240;
  const speed = driving ? 20 + ((i * 7) % 60) : 0;
  return {
    id: `a-${String(i).padStart(5, '0')}${suffix}`,
    vehicle_id: ALPHA,
    recorded_at: new Date(atMs).toISOString(),
    provider_event_id: `ct-${String(i).padStart(5, '0')}${suffix}`,
    provider: 'cartrack',
    account_ref: 'velocity',
    ignition: driving || i % 360 >= 40,
    lat: -26.2 + i * 0.0001,
    lon: 28.0 + i * 0.00012,
    speed_kph: speed,
    is_speeding: speed > 70,
    odometer_km: 10_000 + i * 0.4,
    linear_g: i % 180 === 5 ? -0.51 : 0,
    lateral_g: 0,
    provider_event_type: i % 180 === 5 && speed >= 20 ? 'HARSH_BRAKING' : 'PERIODIC_EVENT',
  };
}

/**
 * `cartrack/velocity`: dense, odometer-bearing, event-bearing — and carrying one pair of fixes
 * that share an instant, which is the shape a bare `recorded_at >` pager silently drops.
 */
export function alphaPositions(): FakePositionRow[] {
  const rows: FakePositionRow[] = [];
  let i = 0;
  for (const day of DAYS) {
    for (let k = 0; k < FIXES_PER_DAY; k += 1) {
      rows.push(alphaFix(i, dayStart(day) + k * CADENCE_MS));
      i += 1;
    }
  }
  // The twin: a second, DIFFERENT fix at an instant already occupied. 164 such groups exist in 7
  // days of production, on all seven cartrack/velocity vehicles.
  const twinMs = Date.parse(TWIN_AT);
  rows.push({ ...alphaFix(FIXES_PER_DAY + 100, twinMs, 'b'), ignition: true, speed_kph: 0 });
  return rows;
}

/** `netstar/europcar`: ten snapshot fixes a day, no odometer at all, two-hour-ish gaps. */
export function betaPositions(): FakePositionRow[] {
  const rows: FakePositionRow[] = [];
  let i = 0;
  for (const day of DAYS) {
    for (let k = 0; k < 10; k += 1) {
      const atMs = dayStart(day) + k * 8_640_000;
      rows.push({
        id: `b-${String(i).padStart(5, '0')}`,
        vehicle_id: BETA,
        recorded_at: new Date(atMs).toISOString(),
        provider_event_id: `ns-${String(i).padStart(5, '0')}`,
        provider: 'netstar',
        account_ref: 'europcar',
        ignition: k % 3 !== 0,
        lat: -25.7 + i * 0.01,
        lon: 28.2 + i * 0.011,
        speed_kph: k % 3 === 1 ? 45 : 0,
        is_speeding: false,
        odometer_km: null,
        linear_g: null,
        lateral_g: null,
        provider_event_type: null,
      });
      i += 1;
    }
  }
  return rows;
}

export function allPositions(): FakePositionRow[] {
  return [...alphaPositions(), ...betaPositions()];
}

/** A clock comfortably after the fixture, so "yesterday" is the last fixture day. */
export const REQUESTED_AT = new Date(dayStart('2026-08-23') + 6 * 3_600_000).toISOString();

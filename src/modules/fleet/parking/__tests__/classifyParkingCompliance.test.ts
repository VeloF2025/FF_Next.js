import { describe, it, expect } from 'vitest';
import {
  classifyParkingCompliance,
  STALE_FIX_MAX_HOURS,
} from '../classifyParkingCompliance';
import type { ParkingLocation } from '../types';

const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

// Braamfontein-ish. 0.0018 deg latitude is ~200 m.
const LOCATION: ParkingLocation = {
  id: 'loc-1',
  lat: -26.1929,
  lon: 28.0305,
  radiusM: 200,
};

/** A fix `hoursAgo` before CHECK_AT at the given coordinates. */
function fixAt(hoursAgo: number, lat: number, lon: number) {
  return {
    recordedAt: new Date(CHECK_AT.getTime() - hoursAgo * 3600 * 1000),
    lat,
    lon,
  };
}

describe('classifyParkingCompliance', () => {
  it('returns no_address when the vehicle has no declared location', () => {
    const out = classifyParkingCompliance({
      location: null,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
    expect(out.distanceM).toBeNull();
  });

  it('prefers no_address over not_verifiable when both apply', () => {
    const out = classifyParkingCompliance({
      location: null,
      hasTracker: false,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
  });

  it('returns not_verifiable when the vehicle has no tracker', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: false,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('not_verifiable');
  });

  it('returns unknown when there is no fix at all', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
    expect(out.lastFixAgeSeconds).toBeNull();
  });

  it('returns compliant for a fresh fix at the declared spot', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.distanceM).toBe(0);
    expect(out.lastFixAgeSeconds).toBe(3600);
  });

  it('returns violation for a fresh fix far from the declared spot', () => {
    // ~1.1 km north
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat + 0.01, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('violation');
    expect(out.distanceM).toBeGreaterThan(900);
  });

  // The weekend case: parked Friday evening, checked Sunday night. The
  // newest fix is from a previous DAY but well inside the staleness
  // ceiling, so it must classify on distance, not fall through to unknown.
  it('classifies on distance when the fix is from a previous day but not stale', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(51, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.lastFixAgeSeconds).toBe(51 * 3600);
  });

  it('treats a fix exactly at the staleness ceiling as still usable', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
  });

  it('returns unknown one second beyond the staleness ceiling', () => {
    const lastFix = {
      recordedAt: new Date(
        CHECK_AT.getTime() - (STALE_FIX_MAX_HOURS * 3600 + 1) * 1000
      ),
      lat: LOCATION.lat,
      lon: LOCATION.lon,
    };
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  // Guards the asymmetric rule rejected in spec section 5.1: a stale fix
  // INSIDE the radius must still be unknown, never compliant.
  it('returns unknown for a stale fix even when it sits inside the radius', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS + 24, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  it('still reports distance and age for a stale fix, as evidence', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS + 1, LOCATION.lat + 0.01, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
    expect(out.distanceM).toBeGreaterThan(900);
    expect(out.lastFixAgeSeconds).toBe((STALE_FIX_MAX_HOURS + 1) * 3600);
  });

  // Pins the comparison as `<=`, not `<`. The exact haversine distance is
  // measured first rather than hard-coded, so the test cannot drift if the
  // distance helper is ever refined.
  it('is compliant when distance equals the radius exactly, and violation one metre inside that', () => {
    const offsetFix = fixAt(1, LOCATION.lat + 0.0018, LOCATION.lon);

    const measured = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: 100_000 },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    const exact = measured.distanceM as number;
    expect(exact).toBeGreaterThan(0);

    const atBoundary = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: exact },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    expect(atBoundary.result).toBe('compliant');

    const justInside = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: exact - 1 },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    expect(justInside.result).toBe('violation');
  });

  it('returns unknown for invalid fix coordinates', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: { recordedAt: CHECK_AT, lat: Number.NaN, lon: 28.03 },
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  it('returns no_address for invalid location coordinates', () => {
    const out = classifyParkingCompliance({
      location: { ...LOCATION, lat: Number.NaN },
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
  });

  // Clock skew between the tracker and the server must not produce a
  // negative age that silently passes the staleness check.
  it('clamps a future-dated fix to zero age', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(-2, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.lastFixAgeSeconds).toBe(0);
  });
});

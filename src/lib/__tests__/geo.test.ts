import { describe, it, expect } from 'vitest';
import { haversineDistanceM, isValidLatLon } from '../geo';

describe('haversineDistanceM', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });

  it('returns ~111 km for a 1-degree latitude step at the equator', () => {
    const m = haversineDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(m).toBeGreaterThan(110_000);
    expect(m).toBeLessThan(112_000);
  });

  it('returns ~194 m for a 1-degree longitude step at 89.9°N', () => {
    // At 89.9°N, 1° of longitude is ~194m. Tight bound catches any
    // accidental swap of lat/lon in the formula.
    const m = haversineDistanceM({ lat: 89.9, lon: 0 }, { lat: 89.9, lon: 1 });
    expect(m).toBeGreaterThan(150);
    expect(m).toBeLessThan(220);
  });

  it('matches a known JHB → CPT distance within 1%', () => {
    // Johannesburg → Cape Town great-circle: ~1269 km
    const m = haversineDistanceM(
      { lat: -26.2041, lon: 28.0473 },
      { lat: -33.9249, lon: 18.4241 }
    );
    expect(m).toBeGreaterThan(1_260_000);
    expect(m).toBeLessThan(1_280_000);
  });
});

describe('isValidLatLon', () => {
  it('accepts in-range coordinates', () => {
    expect(isValidLatLon({ lat: 0, lon: 0 })).toBe(true);
    expect(isValidLatLon({ lat: -26.2, lon: 28.0 })).toBe(true);
    expect(isValidLatLon({ lat: 90, lon: 180 })).toBe(true);
    expect(isValidLatLon({ lat: -90, lon: -180 })).toBe(true);
  });

  it('rejects out-of-range', () => {
    expect(isValidLatLon({ lat: 91, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: 0, lon: 181 })).toBe(false);
    expect(isValidLatLon({ lat: -91, lon: 0 })).toBe(false);
  });

  it('rejects NaN and non-finite', () => {
    expect(isValidLatLon({ lat: NaN, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: Infinity, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: 0, lon: -Infinity })).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isValidLatLon({ lat: 0 })).toBe(false);
    expect(isValidLatLon({ lon: 0 })).toBe(false);
    expect(isValidLatLon({})).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(isValidLatLon({ lat: '0' as unknown as number, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: 0, lon: null as unknown as number })).toBe(false);
  });
});

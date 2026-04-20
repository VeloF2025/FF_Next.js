/**
 * Unit tests for matchGeofence — the nearest-site logic that decides
 * which geofence a clock-in is assigned to. A regression here would
 * silently misassign timesheet hours to the wrong site, which is the
 * kind of bug nobody notices until month-end billing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { matchGeofence } from '../geofenceUtils';

// Test coordinates: Lawley POP area (actual Blitz project location).
const DEVICE = { lat: -26.3820, lon: 27.8180 };

// Centre point ~10 m from DEVICE.
const POP_CENTRE = { lat: -26.38205, lon: 27.81805 };
// Centre point ~2 km from DEVICE (still inside a 5 km region geofence).
const REGION_CENTRE = { lat: -26.3990, lon: 27.8200 };

function site(id: string, name: string, centre: { lat: number; lon: number }, radiusKm: number) {
  return { id, name, lat: centre.lat, lon: centre.lon, radius_km: radiusKm };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('matchGeofence — tightest enclosing', () => {
  it('picks the tightest radius when device is inside two nested fences', async () => {
    // POP 1 (radius 0.1 km = 100 m, centre 10 m from device) AND
    // Lawley region (radius 5 km, centre 2 km from device).
    // Device is inside both. Expect POP 1 (the smaller radius).
    mocks.sql.mockResolvedValueOnce([
      site('pop-1',    'Lawley POP 1', POP_CENTRE, 0.1),
      site('region',   'Lawley Region', REGION_CENTRE, 5),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.inside).toBe(true);
    expect(r.siteId).toBe('pop-1');
    expect(r.fallback).toBe(false);
  });

  it('is deterministic regardless of DB row order (reverse order)', async () => {
    mocks.sql.mockResolvedValueOnce([
      site('region', 'Lawley Region', REGION_CENTRE, 5),
      site('pop-1',  'Lawley POP 1', POP_CENTRE, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.siteId).toBe('pop-1');
  });

  it('breaks ties on site id when radius and distance both match', async () => {
    // Two identical sites (shouldn't happen in prod but let's be honest).
    mocks.sql.mockResolvedValueOnce([
      site('zzz-dup', 'Dup Z', POP_CENTRE, 0.1),
      site('aaa-dup', 'Dup A', POP_CENTRE, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.siteId).toBe('aaa-dup');
  });
});

describe('matchGeofence — fallback to home site', () => {
  it('returns fallback when device is outside all radii and home site is valid', async () => {
    // Main query: no sites match (device far from any of them).
    mocks.sql.mockResolvedValueOnce([
      site('far', 'Far Away', { lat: 0, lon: 0 }, 0.1),
    ]);
    // Home site lookup: valid coords.
    mocks.sql.mockResolvedValueOnce([
      site('home-site', 'Home Site', POP_CENTRE, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: 'home-site' });
    expect(r.inside).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.siteId).toBe('home-site');
    expect(r.distanceM).toBeLessThan(100);
  });

  it('returns no-match when there is no home site and no radius hit', async () => {
    mocks.sql.mockResolvedValueOnce([
      site('far', 'Far Away', { lat: 0, lon: 0 }, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.inside).toBe(false);
    expect(r.fallback).toBe(false);
    expect(r.siteId).toBeNull();
  });

  it('refuses to fall back when the home site has invalid coordinates', async () => {
    mocks.sql.mockResolvedValueOnce([
      site('far', 'Far Away', { lat: 0, lon: 0 }, 0.1),
    ]);
    // Home site row with NaN lat — treat as no-fallback.
    mocks.sql.mockResolvedValueOnce([
      { id: 'home-corrupt', name: 'Home Corrupt', lat: 'not-a-number', lon: 27.8, radius_km: 0.1 },
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: 'home-corrupt' });
    expect(r.inside).toBe(false);
    expect(r.fallback).toBe(false);
    expect(r.siteId).toBeNull();
  });
});

describe('matchGeofence — malformed row handling', () => {
  it('skips rows with non-finite lat/lon without throwing', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'bad', name: 'Bad Row', lat: NaN, lon: NaN, radius_km: 1 },
      site('good', 'Good', POP_CENTRE, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.siteId).toBe('good');
    expect(r.inside).toBe(true);
  });

  it('skips rows with non-positive radius', async () => {
    mocks.sql.mockResolvedValueOnce([
      site('zero', 'Zero Radius', POP_CENTRE, 0),
      site('negative', 'Negative', POP_CENTRE, -1),
      site('good', 'Good', POP_CENTRE, 0.1),
    ]);
    const r = await matchGeofence({ device: DEVICE, homeSiteId: null });
    expect(r.siteId).toBe('good');
  });
});

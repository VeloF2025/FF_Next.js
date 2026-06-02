// src/modules/sitecam/lib/__tests__/geofence.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  haversineMeters,
  classifyGeofence,
  buildReading,
  encodeGeofenceParam,
  decodeGeofenceParam,
  readDeviceLocation,
  GEOFENCE_THRESHOLD_M,
} from '../geofence';

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(-26.1, 27.5, -26.1, 27.5)).toBeLessThan(0.5);
  });

  it('computes a known short distance (~111 m per 0.001° latitude)', () => {
    const d = haversineMeters(-26.100, 27.500, -26.101, 27.500);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
});

describe('classifyGeofence precedence + accuracy slack', () => {
  const planned = { plannedLat: -26.1, plannedLon: 27.5 };

  it('no_planned_coords when planned missing (even if device present)', () => {
    const r = classifyGeofence({ plannedLat: null, plannedLon: null, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 });
    expect(r.status).toBe('no_planned_coords');
    expect(r.distanceM).toBeNull();
  });

  it('device_gps_off when device missing but planned present', () => {
    const r = classifyGeofence({ ...planned, deviceLat: null, deviceLon: null, accuracyM: null });
    expect(r.status).toBe('device_gps_off');
    expect(r.distanceM).toBeNull();
  });

  it('on_site when within threshold', () => {
    const r = classifyGeofence({ ...planned, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 });
    expect(r.status).toBe('on_site');
    expect(r.distanceM).not.toBeNull();
  });

  it('out_of_range only when distance - accuracy exceeds threshold', () => {
    const far = classifyGeofence({ ...planned, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5 });
    expect(far.status).toBe('out_of_range');
    const fuzzy = classifyGeofence({ ...planned, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 200 });
    expect(fuzzy.status).toBe('on_site');
  });

  it('treats null accuracy as 0 (strict threshold)', () => {
    const r = classifyGeofence({ ...planned, deviceLat: -26.1003, deviceLon: 27.5, accuracyM: null });
    expect(r.status).toBe('out_of_range');
  });
});

describe('encode/decode round-trip', () => {
  it('round-trips a reading', () => {
    const reading = buildReading({ plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5 });
    const decoded = decodeGeofenceParam(encodeGeofenceParam(reading));
    expect(decoded).toEqual(reading);
  });

  it('returns null for malformed param', () => {
    expect(decodeGeofenceParam('not-json')).toBeNull();
    expect(decodeGeofenceParam(undefined)).toBeNull();
  });
});

describe('readDeviceLocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves coords on success', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: -26.1, longitude: 27.5, accuracy: 8 } } as GeolocationPosition),
      },
    });
    await expect(readDeviceLocation(1000)).resolves.toEqual({ lat: -26.1, lon: 27.5, accuracy: 8 });
  });

  it('resolves null when geolocation is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(readDeviceLocation(1000)).resolves.toBeNull();
  });

  it('resolves null on error/denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) =>
          err({ code: 1, message: 'denied' } as GeolocationPositionError),
      },
    });
    await expect(readDeviceLocation(1000)).resolves.toBeNull();
  });
});

describe('GEOFENCE_THRESHOLD_M', () => {
  it('is 25', () => expect(GEOFENCE_THRESHOLD_M).toBe(25));
});

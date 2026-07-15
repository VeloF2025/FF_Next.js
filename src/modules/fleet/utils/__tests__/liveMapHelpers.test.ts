/**
 * Pure-logic tests for the fleet live map.
 *
 * These guard behaviour the map component depends on but that jsdom cannot
 * meaningfully exercise (Leaflet rendering): marker colour precedence, the
 * "how old is this fix" label, and which vehicles are safe to plot at all.
 */
import { describe, expect, it } from 'vitest';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import { ageLabel, colourFor, partitionVehicles } from '../liveMapHelpers';

function vehicle(overrides: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    vehicleId: 'v1',
    registration: 'ABC 123 GP',
    driverName: 'Jane Doe',
    provider: 'cartrack',
    lat: -26.1,
    lon: 28.05,
    speedKph: 40,
    ignition: true,
    isSpeeding: false,
    recordedAt: '2026-07-15T10:00:00.000Z',
    ageSeconds: 60,
    isStale: false,
    trackingState: 'tracked',
    ...overrides,
  };
}

describe('colourFor', () => {
  it('reads stale fixes as stale (grey) even when the last known state was speeding', () => {
    // Precedence matters: we don't know a stale vehicle is STILL speeding.
    const v = vehicle({ isStale: true, isSpeeding: true, ignition: true });
    expect(colourFor(v)).toBe('#9ca3af');
  });

  it('reads a fresh speeding vehicle as speeding (red)', () => {
    const v = vehicle({ isStale: false, isSpeeding: true });
    expect(colourFor(v)).toBe('#dc2626');
  });

  it('reads a fresh moving (ignition on, not speeding) vehicle as moving (green)', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: true });
    expect(colourFor(v)).toBe('#0f9d6b');
  });

  it('reads a fresh stopped (ignition off) vehicle as stopped (blue)', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: false });
    expect(colourFor(v)).toBe('#2563eb');
  });

  it('treats a stale, non-speeding, ignition-on vehicle as stale, not moving', () => {
    const v = vehicle({ isStale: true, isSpeeding: false, ignition: true });
    expect(colourFor(v)).toBe('#9ca3af');
  });
});

describe('ageLabel', () => {
  it('labels null age as never', () => {
    expect(ageLabel(null)).toBe('never');
  });

  it('labels sub-minute ages in seconds', () => {
    expect(ageLabel(0)).toBe('0s ago');
    expect(ageLabel(45)).toBe('45s ago');
    expect(ageLabel(59)).toBe('59s ago');
  });

  it('labels sub-hour ages in whole minutes', () => {
    expect(ageLabel(60)).toBe('1 min ago');
    expect(ageLabel(119)).toBe('1 min ago');
    expect(ageLabel(3599)).toBe('59 min ago');
  });

  it('labels hour-plus ages in whole hours', () => {
    expect(ageLabel(3600)).toBe('1h ago');
    expect(ageLabel(7199)).toBe('1h ago');
    expect(ageLabel(10800)).toBe('3h ago');
  });
});

describe('partitionVehicles', () => {
  it('plots vehicles that have both coordinates', () => {
    const v = vehicle();
    const { plotted, notPlotted } = partitionVehicles([v]);
    expect(plotted).toEqual([v]);
    expect(notPlotted).toEqual([]);
  });

  it('excludes an untracked vehicle (no coordinates) from plotting', () => {
    const v = vehicle({ trackingState: 'untracked', lat: null, lon: null, recordedAt: null, ageSeconds: null });
    const { plotted, notPlotted } = partitionVehicles([v]);
    expect(plotted).toEqual([]);
    expect(notPlotted).toEqual([v]);
  });

  it('excludes a vehicle marked tracked but missing a coordinate (data anomaly) from plotting', () => {
    // trackingState alone is not a safe signal to plot on — a partial fix
    // (e.g. lat present, lon null) must never reach the map.
    const v = vehicle({ trackingState: 'tracked', lat: -26.1, lon: null });
    const { plotted, notPlotted } = partitionVehicles([v]);
    expect(plotted).toEqual([]);
    expect(notPlotted).toEqual([v]);
  });

  it('splits a mixed list correctly', () => {
    const tracked = vehicle({ vehicleId: 'v1' });
    const awaiting = vehicle({ vehicleId: 'v2', trackingState: 'awaiting_data', lat: null, lon: null, recordedAt: null, ageSeconds: null });
    const untracked = vehicle({ vehicleId: 'v3', trackingState: 'untracked', lat: null, lon: null, recordedAt: null, ageSeconds: null });
    const { plotted, notPlotted } = partitionVehicles([tracked, awaiting, untracked]);
    expect(plotted.map((v) => v.vehicleId)).toEqual(['v1']);
    expect(notPlotted.map((v) => v.vehicleId)).toEqual(['v2', 'v3']);
  });
});

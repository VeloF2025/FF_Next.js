/**
 * Pure-logic tests for the fleet live map.
 *
 * These guard behaviour the map component depends on but that jsdom cannot
 * meaningfully exercise (Leaflet rendering): marker colour precedence, the
 * "how old is this fix" label, and which vehicles are safe to plot at all.
 */
import { describe, expect, it } from 'vitest';
import type { LiveVehicle, TrackingState } from '@/pages/api/fleet/positions/live';
import {
  STATUS_STYLE,
  ageLabel,
  colourFor,
  notPlottedReason,
  partitionVehicles,
  statusFor,
} from '../liveMapHelpers';

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
  it('reads stale fixes as unknown even when the last known state was speeding', () => {
    // Precedence still matters where we are genuinely uncertain: we don't know
    // a stale ignition-on vehicle is STILL speeding.
    const v = vehicle({ isStale: true, isSpeeding: true, ignition: true });
    expect(statusFor(v)).toBe('unknown');
  });

  it('reads a fresh speeding vehicle as speeding (red)', () => {
    const v = vehicle({ isStale: false, isSpeeding: true });
    expect(colourFor(v)).toBe('#dc2626');
  });

  it('reads a fresh moving (ignition on, not speeding) vehicle as moving (green)', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: true });
    expect(colourFor(v)).toBe('#0f9d6b');
  });

  it('reads an ignition-off vehicle as parked', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: false });
    expect(statusFor(v)).toBe('parked');
  });

  it('treats a stale, non-speeding, ignition-on vehicle as unknown, not moving', () => {
    const v = vehicle({ isStale: true, isSpeeding: false, ignition: true });
    expect(statusFor(v)).toBe('unknown');
  });

  it('an ignition-off vehicle stays PARKED however old the fix is', () => {
    // The bug this fixes: every plotted vehicle read 'stale' at 0.35 opacity
    // on 2026-08-08 (18/18, 16 of them ignition-off) because staleness
    // outranked everything. A parked car does not move, so its position stays
    // true — 41 hours old was a real observed age.
    const v = vehicle({ isStale: true, ignition: false, ageSeconds: 41 * 3600 });
    expect(statusFor(v)).toBe('parked');
  });

  it('an ignition-off vehicle is parked, not speeding, when the record claims both', () => {
    // Self-contradictory data (4 such rows exist in all of history). An engine
    // that is off is not moving, so the speeding bit is the wrong one.
    const v = vehicle({ isStale: false, isSpeeding: true, ignition: false });
    expect(statusFor(v)).toBe('parked');
  });

  it('treats unknown ignition with a fresh fix as unknown, not parked', () => {
    // null is "the tracker didn't say", which must not be read as "engine off".
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: null });
    expect(statusFor(v)).toBe('unknown');
  });

  it('gives parked a far more visible fill than unknown', () => {
    // The whole point of the change is legibility on a pale basemap.
    expect(STATUS_STYLE.parked.fillOpacity).toBeGreaterThan(STATUS_STYLE.unknown.fillOpacity);
    expect(colourFor(vehicle({ ignition: false }))).toBe(STATUS_STYLE.parked.fill);
  });

  it('gives every status a distinct colour, so the legend can tell them apart', () => {
    const fills = Object.values(STATUS_STYLE).map((s) => s.fill);
    expect(new Set(fills).size).toBe(fills.length);
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

describe('notPlottedReason', () => {
  it('returns "no tracker" for an untracked vehicle', () => {
    const v = vehicle({ trackingState: 'untracked' });
    expect(notPlottedReason(v)).toBe('no tracker');
  });

  it('returns "awaiting data" for a vehicle awaiting first position', () => {
    const v = vehicle({ trackingState: 'awaiting_data' });
    expect(notPlottedReason(v)).toBe('awaiting data');
  });

  it('returns "no position data" as fallback for any other tracking state', () => {
    const v = vehicle({ trackingState: 'tracked' });
    expect(notPlottedReason(v)).toBe('no position data');
  });

  it('returns "no position data" for unknown tracking state', () => {
    // Deliberately force a state outside the union: this pins the fallback
    // branch against a future TrackingState gaining a member that nobody
    // teaches this function about. Cast through `unknown`, not `any`.
    const v = vehicle({ trackingState: 'unknown_state' as unknown as TrackingState });
    expect(notPlottedReason(v)).toBe('no position data');
  });
});

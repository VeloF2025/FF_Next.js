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
  PARKED_SILENT_AFTER_SECONDS,
  STATUS_STYLE,
  swatchBackground,
  type VehicleStatus,
  ageLabel,
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

describe('statusFor', () => {
  it('does not keep a stale speeding fix red — but does flag it as lost contact', () => {
    // Precedence still matters where we are genuinely uncertain: we don't know
    // a stale ignition-on vehicle is STILL speeding. It is no longer dismissed
    // as 'unknown' either — the engine was running and the feed went quiet,
    // which is the alarming case, not the ignorable one.
    const v = vehicle({ isStale: true, isSpeeding: true, ignition: true });
    expect(statusFor(v)).toBe('lostContact');
  });

  it('reads a fresh speeding vehicle as speeding', () => {
    const v = vehicle({ isStale: false, isSpeeding: true });
    expect(statusFor(v)).toBe('speeding');
  });

  it('reads a fresh moving (ignition on, not speeding) vehicle as moving', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: true });
    expect(statusFor(v)).toBe('moving');
  });

  it('reads an ignition-off vehicle as parked', () => {
    const v = vehicle({ isStale: false, isSpeeding: false, ignition: false });
    expect(statusFor(v)).toBe('parked');
  });

  it('treats a stale, non-speeding, ignition-on vehicle as lost contact, not moving', () => {
    // Not 'moving' (we don't know that any more) and not 'unknown' (we know
    // more than nothing: it was running when we last heard).
    const v = vehicle({ isStale: true, isSpeeding: false, ignition: true });
    expect(statusFor(v)).toBe('lostContact');
  });

  it('an ignition-off vehicle stays parked despite a stale fix, within the ceiling', () => {
    // The bug this fixes: every plotted vehicle read 'stale' at 0.35 opacity
    // on 2026-08-08 (18/18, 16 of them ignition-off) because staleness
    // outranked everything. Stale here (>15 min) but well inside the 6h
    // ceiling, which is the normal weekend state for a 2-hourly provider.
    const v = vehicle({ isStale: true, ignition: false, ageSeconds: 3 * 3600 });
    expect(statusFor(v)).toBe('parked');
  });

  it('a parked vehicle that has gone quiet past the ceiling is flagged, not silently parked', () => {
    // 'parked' vouches for the POSITION, never the tracker. A flat, disabled
    // or removed unit also says nothing, and its last word may well have been
    // "ignition off" — so it must not look identical to a car parked 2
    // minutes ago. 41h was a real observed age on 2026-08-08.
    const v = vehicle({ isStale: true, ignition: false, ageSeconds: 41 * 3600 });
    expect(statusFor(v)).toBe('parkedSilent');
  });

  it('treats a missing age as silence rather than freshness', () => {
    const v = vehicle({ isStale: true, ignition: false, ageSeconds: null });
    expect(statusFor(v)).toBe('parkedSilent');
  });

  it('puts the ceiling boundary on the silent side only once exceeded', () => {
    const at = vehicle({ ignition: false, ageSeconds: PARKED_SILENT_AFTER_SECONDS });
    const past = vehicle({ ignition: false, ageSeconds: PARKED_SILENT_AFTER_SECONDS + 1 });
    expect(statusFor(at)).toBe('parked');
    expect(statusFor(past)).toBe('parkedSilent');
  });

  it('a FRESH speeding fix outranks ignition-off, so a real one is never hidden', () => {
    // The two disagree when a subsystem lags. A false red costs one click; a
    // missed speeding vehicle costs an incident.
    const v = vehicle({ isStale: false, isSpeeding: true, ignition: false });
    expect(statusFor(v)).toBe('speeding');
  });

  it('a STALE speeding fix does not keep a vehicle red forever', () => {
    // It tells us what the vehicle was doing, not what it is doing.
    const v = vehicle({ isStale: true, isSpeeding: true, ignition: false, ageSeconds: 3 * 3600 });
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
  });

  it('styles every status, and distinguishes the two parked states visually', () => {
    // parkedSilent deliberately shares the parked fill — it IS a parked car —
    // so the dashed outline is the only thing telling them apart. Losing it
    // would re-hide the dark trackers this ceiling exists to surface.
    for (const status of Object.keys(STATUS_STYLE)) {
      expect(STATUS_STYLE[status as keyof typeof STATUS_STYLE].label).toBeTruthy();
    }
    expect(STATUS_STYLE.parkedSilent.dash).toBeTruthy();
    expect(STATUS_STYLE.parked.dash).toBeUndefined();
    expect(STATUS_STYLE.parkedSilent.fillOpacity).toBeLessThan(STATUS_STYLE.parked.fillOpacity);
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
    const v = vehicle({
      trackingState: 'untracked',
      lat: null,
      lon: null,
      recordedAt: null,
      ageSeconds: null,
    });
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
    const awaiting = vehicle({
      vehicleId: 'v2',
      trackingState: 'awaiting_data',
      lat: null,
      lon: null,
      recordedAt: null,
      ageSeconds: null,
    });
    const untracked = vehicle({
      vehicleId: 'v3',
      trackingState: 'untracked',
      lat: null,
      lon: null,
      recordedAt: null,
      ageSeconds: null,
    });
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

describe('swatchBackground', () => {
  // The legend swatch must fade its FILL only. Both `opacity` and
  // `filter: opacity()` composite the whole element including box-shadow, and
  // Tailwind's ring-white IS a box-shadow — so either would dim the white ring
  // the real marker always keeps opaque. Baking alpha into the colour is the
  // only form that leaves the ring alone.
  it('bakes the fill opacity into the colour as an alpha channel', () => {
    expect(swatchBackground('parked')).toBe('#7c3aede6'); // 0.9 -> e6
    expect(swatchBackground('parkedSilent')).toBe('#7c3aed73'); // 0.45 -> 73
  });

  it('returns a valid 8-digit hex for every status', () => {
    for (const status of Object.keys(STATUS_STYLE) as VehicleStatus[]) {
      expect(swatchBackground(status)).toMatch(/^#[0-9a-f]{8}$/);
    }
  });

  it('keeps the dimmer status visibly dimmer once baked', () => {
    const alpha = (s: VehicleStatus) => parseInt(swatchBackground(s).slice(7), 16);
    expect(alpha('parkedSilent')).toBeLessThan(alpha('parked'));
  });
});

describe('lostContact — the case that used to hide inside grey', () => {
  it('an engine last known RUNNING that then goes silent is lostContact, not unknown', () => {
    // HG16TDGP on 2026-08-09: last word "85 km/h, ignition on", then ~14h of
    // silence, while the poll it rides kept succeeding and its two siblings on
    // the same feed reported themselves parked at 0 km/h. It rendered the same
    // grey as an ordinary unknown.
    const v = vehicle({ ignition: true, isStale: true, ageSeconds: 13.5 * 3600 });
    expect(statusFor(v)).toBe('lostContact');
  });

  it('a fresh ignition-on vehicle is still just moving', () => {
    expect(statusFor(vehicle({ ignition: true, isStale: false }))).toBe('moving');
  });

  it('unknown now means only "the tracker never said" — ignition null', () => {
    // The point of splitting lostContact out: 'unknown' stops being a bucket
    // that quietly holds a vehicle we have real reason to worry about.
    expect(statusFor(vehicle({ ignition: null, isStale: true }))).toBe('unknown');
    expect(statusFor(vehicle({ ignition: null, isStale: false }))).toBe('unknown');
  });

  it('a silent PARKED vehicle is not lostContact — silence there is expected', () => {
    // A parked car emits nothing by design, so it must not raise the alarm
    // that a vehicle which was driving does.
    const v = vehicle({ ignition: false, isStale: true, ageSeconds: 13.5 * 3600 });
    expect(statusFor(v)).toBe('parkedSilent');
  });

  it('is styled to demand attention: distinct colour, and dashed like the other stale state', () => {
    expect(STATUS_STYLE.lostContact.fill).not.toBe(STATUS_STYLE.unknown.fill);
    expect(STATUS_STYLE.lostContact.fill).not.toBe(STATUS_STYLE.speeding.fill);
    expect(STATUS_STYLE.lostContact.dash).toBeTruthy();
    expect(STATUS_STYLE.lostContact.fillOpacity).toBeGreaterThan(STATUS_STYLE.unknown.fillOpacity);
  });
});

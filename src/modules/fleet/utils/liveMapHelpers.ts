/**
 * Pure logic for the fleet live map (FleetMap component + /fleet/map page).
 *
 * Extracted from the map component so it can be unit-tested directly —
 * Leaflet cannot render meaningfully under jsdom, but the decisions that
 * drive what gets drawn and how it reads to a human are plain functions.
 */
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';

export type PlottedVehicle = LiveVehicle & { lat: number; lon: number };

export type VehicleStatus = 'parked' | 'speeding' | 'moving' | 'unknown';

/**
 * What the map is actually asserting about a vehicle.
 *
 * `ignition === false` wins outright, and that is the whole point of this
 * function. A car with its engine off is not moving, so its last position
 * stays true for as long as it stays off — fix age is irrelevant to a parked
 * car in a way it is not to a driving one. Ranking staleness above it (the
 * previous behaviour) painted the entire fleet the "we don't know" grey every
 * weekend: 18 of 18 plotted vehicles on 2026-08-08, 16 of them reporting
 * ignition off. The one state we were most certain about rendered as the one
 * we were least certain about, at the lowest opacity on the map.
 *
 * It also outranks `isSpeeding`, which reads backwards until you notice the
 * two can only disagree when the data is self-contradictory: a record saying
 * "engine off, speeding" is wrong about one of them, and "engine off" is the
 * claim a tracker gets right. 4 such rows exist in all of history.
 *
 * Everywhere else staleness still outranks the last-known state, for the
 * original reason: a 3-hour-old "moving" fix does not mean the vehicle is
 * moving now, so it must not read as though it does.
 */
export function statusFor(v: LiveVehicle): VehicleStatus {
  if (v.ignition === false) return 'parked';
  if (v.isStale) return 'unknown';
  if (v.isSpeeding) return 'speeding';
  if (v.ignition === true) return 'moving';
  return 'unknown';
}

/**
 * Fill, opacity and label per status, in one place so the map markers and the
 * legend cannot drift apart.
 *
 * Every marker gets an opaque white stroke. The OSM basemap is pale grey with
 * pale roads, so a low-opacity fill of any colour dissolves into it; the halo
 * is what separates a marker from the map rather than the colour itself.
 */
export const STATUS_STYLE: Record<
  VehicleStatus,
  { fill: string; fillOpacity: number; label: string }
> = {
  parked: { fill: '#7c3aed', fillOpacity: 0.9, label: 'Parked' },
  speeding: { fill: '#dc2626', fillOpacity: 0.9, label: 'Speeding' },
  moving: { fill: '#0f9d6b', fillOpacity: 0.9, label: 'Moving' },
  unknown: { fill: '#6b7280', fillOpacity: 0.6, label: 'No recent fix' },
};

/** Marker colour for a vehicle. */
export function colourFor(v: LiveVehicle): string {
  return STATUS_STYLE[statusFor(v)].fill;
}

/** Human-readable age of a position fix, or 'never' if there isn't one. */
export function ageLabel(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Split vehicles into those safe to plot (both coordinates present) and
 * everything else. Plotting decisions must key off the coordinates
 * actually being present, not off `trackingState` — a row could in
 * principle be marked 'tracked' with a partial fix (one coordinate null);
 * that must still fall through to "not plotted" rather than crash or draw
 * a marker at a bogus location.
 */
export function partitionVehicles(vehicles: LiveVehicle[]): {
  plotted: PlottedVehicle[];
  notPlotted: LiveVehicle[];
} {
  const plotted: PlottedVehicle[] = [];
  const notPlotted: LiveVehicle[] = [];
  for (const v of vehicles) {
    if (v.lat !== null && v.lon !== null) {
      plotted.push({ ...v, lat: v.lat, lon: v.lon });
    } else {
      notPlotted.push(v);
    }
  }
  return { plotted, notPlotted };
}

/** Short reason a vehicle isn't on the map, for the "not on the map" list. */
export function notPlottedReason(v: LiveVehicle): string {
  if (v.trackingState === 'untracked') return 'no tracker';
  if (v.trackingState === 'awaiting_data') return 'awaiting data';
  return 'no position data';
}

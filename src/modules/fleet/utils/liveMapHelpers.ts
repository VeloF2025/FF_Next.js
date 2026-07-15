/**
 * Pure logic for the fleet live map (FleetMap component + /fleet/map page).
 *
 * Extracted from the map component so it can be unit-tested directly —
 * Leaflet cannot render meaningfully under jsdom, but the decisions that
 * drive what gets drawn and how it reads to a human are plain functions.
 */
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';

export type PlottedVehicle = LiveVehicle & { lat: number; lon: number };

/**
 * Marker colour for a vehicle. Precedence matters: a stale fix must read as
 * stale even if the last known state was speeding or moving — we don't know
 * the vehicle is still doing that, only that it was, more than 15 minutes
 * ago. Stale therefore outranks every other signal.
 */
export function colourFor(v: LiveVehicle): string {
  if (v.isStale) return '#9ca3af';
  if (v.isSpeeding) return '#dc2626';
  if (v.ignition) return '#0f9d6b';
  return '#2563eb';
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

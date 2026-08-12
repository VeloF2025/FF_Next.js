/**
 * Pure logic for the fleet live map (FleetMap component + /fleet/map page).
 *
 * Extracted from the map component so it can be unit-tested directly —
 * Leaflet cannot render meaningfully under jsdom, but the decisions that
 * drive what gets drawn and how it reads to a human are plain functions.
 */
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';

export type PlottedVehicle = LiveVehicle & { lat: number; lon: number };

export type VehicleStatus =
  'speeding' | 'lostContact' | 'moving' | 'idling' | 'parked' | 'parkedSilent' | 'unknown';

/**
 * How long a parked vehicle may stay quiet before we stop vouching for it.
 *
 * The slowest providers (Netstar, Ituran) are polled 2-hourly, so a healthy
 * parked vehicle still lands a fix well inside 2 hours; 6 is three times that,
 * which is late enough not to cry wolf over a missed cycle. Against prod on
 * 2026-08-08 it split the fleet 13 plainly parked / 5 gone quiet, the quietest
 * of them silent for over a day.
 */
export const PARKED_SILENT_AFTER_SECONDS = 6 * 3600;

/**
 * What the map is asserting about a vehicle.
 *
 * `ignition === false` is the strong signal here: a car with its engine off is
 * not moving, so its last position stays true for as long as it stays off.
 * Ranking staleness above it (the previous behaviour) painted the whole fleet
 * the "we don't know" grey every weekend — 18 of 18 plotted vehicles on
 * 2026-08-08, 16 of them reporting ignition off, all at the lowest opacity on
 * the map. The state we were most certain about rendered as the one we were
 * least certain about.
 *
 * But "parked" only vouches for the POSITION, never for the tracker. A unit
 * that is flat, disabled, or ripped out of a stolen vehicle also reports
 * nothing, and its last word may well have been "ignition off". So parked
 * carries a ceiling: past PARKED_SILENT_AFTER_SECONDS it becomes
 * `parkedSilent`, which still reads as a parked car but visibly flags that
 * nobody has heard from it. Without that the map loses its only glanceable
 * way to spot a tracker gone dark.
 *
 * A fresh speeding fix outranks everything, including ignition. The two can
 * disagree when a subsystem lags — a real high-speed fix arriving beside a
 * glitched ignition bit — and between a false red and a missed speeding
 * vehicle, the false red costs one click and the miss costs an incident. It
 * must be fresh to count, for the original reason: a stale "speeding" tells
 * us what a vehicle was doing, not what it is doing.
 *
 * `lostContact` is the case worth waking up for, and it used to hide inside the
 * same grey as an ordinary unknown: last we heard the engine was RUNNING, and
 * then the feed went quiet past its own threshold. A moving vehicle that stops
 * reporting is either a tracker that failed mid-trip or a vehicle going
 * somewhere it should not — unlike a parked one, it cannot be explained by
 * "nothing happened, so nothing was sent". On 2026-08-09 that was HG16TDGP:
 * last word "85 km/h, ignition on", then ~14 hours of silence — while the
 * portal poll it rides kept succeeding (complete, 3 of 3 trackers mapped) and
 * its two siblings on that same feed reported themselves properly parked at 0
 * km/h. A quiet feed explains all three; only one of them was moving when it
 * went quiet.
 *
 * `unknown` now means only what it says — the tracker never told us whether the
 * engine was on, so we cannot reason about it either way.
 */
export function statusFor(v: LiveVehicle): VehicleStatus {
  if (!v.isStale && v.isSpeeding) return 'speeding';
  if (v.ignition === false) {
    // A missing age is not evidence of freshness — treat it as silence.
    const quiet = v.ageSeconds === null || v.ageSeconds > PARKED_SILENT_AFTER_SECONDS;
    return quiet ? 'parkedSilent' : 'parked';
  }
  // Engine last known RUNNING, then silence: not "we don't know", but "it was
  // going somewhere and stopped telling us".
  if (v.ignition === true) {
    if (v.isStale) return 'lostContact';
    // Only an explicit zero is evidence of not moving. A null speed means the
    // provider did not say, and inventing "idle" from silence would misreport
    // every feed that omits the field.
    return v.speedKph === 0 ? 'idling' : 'moving';
  }
  return 'unknown';
}

/**
 * Fill, opacity, outline and label per status, in one place so the markers and
 * the legend cannot drift apart.
 *
 * Every marker gets an opaque white stroke. The OSM basemap is pale grey with
 * pale roads, so a low-opacity fill of any colour dissolves into it; the halo
 * is what separates a marker from the map, and the fill only says which kind
 * it is. `dash` breaks that ring up for the one status that means "this is our
 * last word, not our current one".
 */
export const STATUS_STYLE: Record<
  VehicleStatus,
  { fill: string; fillOpacity: number; label: string; dash?: string }
> = {
  speeding: { fill: '#dc2626', fillOpacity: 0.9, label: 'Speeding' },
  // Amber, not red: it demands a look, but it is an unanswered question rather
  // than a confirmed violation. Dashed for the same reason parkedSilent is —
  // the ring being broken is what reads as "no longer current".
  lostContact: { fill: '#d97706', fillOpacity: 0.95, label: 'Lost contact', dash: '4 2' },
  moving: { fill: '#0f9d6b', fillOpacity: 0.9, label: 'Moving' },
  // Same green family as moving — the engine is running either way — but
  // lighter, because the vehicle is not going anywhere.
  idling: { fill: '#0f9d6b', fillOpacity: 0.55, label: 'Idling' },
  parked: { fill: '#7c3aed', fillOpacity: 0.9, label: 'Parked' },
  parkedSilent: { fill: '#7c3aed', fillOpacity: 0.45, label: 'Parked · no contact', dash: '3 3' },
  unknown: { fill: '#6b7280', fillOpacity: 0.6, label: 'No recent fix' },
};

/**
 * The status fill with its opacity baked into the colour, for the legend
 * swatch.
 *
 * Neither `opacity` nor `filter: opacity()` works here: both composite the
 * ELEMENT, box-shadow included, and Tailwind paints `ring-white` as a
 * box-shadow — so either one fades the white ring along with the fill. The
 * real marker never has that problem, because Leaflet's stroke opacity is a
 * separate path attribute pinned to 1. Putting the alpha in the colour leaves
 * the ring alone.
 */
export function swatchBackground(status: VehicleStatus): string {
  const { fill, fillOpacity } = STATUS_STYLE[status];
  const alpha = Math.round(Math.min(Math.max(fillOpacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${fill}${alpha}`;
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

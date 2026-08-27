/**
 * `prolonged_unauthorized_stop` — engine running, going nowhere, nowhere known.
 *
 * The candidate search is PURE; only the "is this a known site" question
 * reaches PostGIS, and it arrives as an injected resolver so the whole detector
 * can be exercised over a fixture.
 *
 * ## It is a seven-vehicle detector, by construction
 *
 * A stop is a duration measured between consecutive fixes, so it needs a feed
 * that actually samples during the stop. Eleven of eighteen tracked vehicles
 * report at a median gap of 10–35 MINUTES; two consecutive fixes 45 minutes
 * apart, both stationary, are indistinguishable from a vehicle that drove away
 * and came back. `DENSE_FEED_MAX_MEDIAN_GAP_SECONDS` refuses to guess: below
 * that cadence the detector reports nothing rather than something plausible.
 * Only `cartrack/velocity` (median 8 s) clears it. That is a property of the
 * feeds, not a defect — do not "fix" it by widening the gate.
 */

import { haversineDistanceM } from '@/lib/geo';
import { findNearestPlace, type NearestPlace } from '../trips/placeResolver';
import { buildSourceEventId, calendarDayKey } from './sourceEventId';
import type { DetectedVehicleEvent, DetectorPosition, VehicleDetectorContext } from './types';

const DETECTOR_ID = 'prolonged_unauthorized_stop';

/**
 * How far a vehicle may wander and still be "stopped", in metres.
 *
 * 50 m absorbs GPS jitter (a few metres per fix) and a shunt across a yard
 * without absorbing a drive to the next street.
 */
export const STOP_RADIUS_METERS = 50;

/**
 * The cadence this detector needs, in seconds between fixes (median).
 *
 * 300 s sits an order of magnitude above `cartrack/velocity`'s measured 8 s
 * median and an order of magnitude below the next feed's 637 s, so it separates
 * the two populations without sitting near either.
 */
export const DENSE_FEED_MAX_MEDIAN_GAP_SECONDS = 300;

export type PlaceResolver = (lat: number, lon: number) => Promise<NearestPlace | null>;

interface Located extends DetectorPosition {
  lat: number;
  lon: number;
}

function hasFix(p: DetectorPosition): p is Located {
  return p.lat !== null && p.lon !== null;
}

/** Median inter-fix gap in seconds, or null when there are fewer than two fixes. */
export function medianGapSeconds(positions: readonly DetectorPosition[]): number | null {
  const gaps: number[] = [];
  let previous: number | null = null;
  for (const position of positions) {
    const current = Date.parse(position.recordedAt);
    if (Number.isNaN(current)) { previous = null; continue; }
    if (previous !== null) gaps.push((current - previous) / 1000);
    previous = current;
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const upper = gaps[middle] ?? 0;
  if (gaps.length % 2 === 1) return upper;
  return ((gaps[middle - 1] ?? 0) + upper) / 2;
}

export interface StopCandidate {
  /** The first qualifying fix IN THE WINDOW — a floor on the real start, not the real start. */
  startedAt: string;
  endedAt: string;
  minutes: number;
  lat: number;
  lon: number;
  positionCount: number;
  /** The run began at the window's oldest fix, so the true stop is older than this. */
  startClampedToWindow: boolean;
}

/**
 * Maximal runs of ignition-on fixes that never leave `STOP_RADIUS_METERS` of
 * where the run started, longer than the rule's threshold.
 *
 * The run breaks on an ignition-off fix, on a fix without coordinates, and on a
 * fix outside the radius — the last of which STARTS A NEW RUN at that fix
 * rather than dropping it, so a vehicle that moves 200 m and then idles for an
 * hour is still caught.
 */
export function findProlongedStops(ctx: VehicleDetectorContext): StopCandidate[] {
  const minimumMs = ctx.rule.unauthorizedStopMinutes * 60_000;
  const stops: StopCandidate[] = [];
  let anchor: Located | null = null;
  let last: Located | null = null;
  let count = 0;

  const close = (): void => {
    if (!anchor || !last) return;
    const ms = Date.parse(last.recordedAt) - Date.parse(anchor.recordedAt);
    if (ms > minimumMs && count >= 2) {
      stops.push({
        startedAt: anchor.recordedAt, endedAt: last.recordedAt,
        minutes: Math.round(ms / 60_000), lat: anchor.lat, lon: anchor.lon, positionCount: count,
        startClampedToWindow: anchor.recordedAt === ctx.positions[0]?.recordedAt,
      });
    }
  };

  for (const position of ctx.positions) {
    if (position.ignition !== true || !hasFix(position)) {
      close();
      anchor = null; last = null; count = 0;
      continue;
    }
    if (anchor && haversineDistanceM(anchor, position) > STOP_RADIUS_METERS) {
      close();
      anchor = position; last = position; count = 1;
      continue;
    }
    if (!anchor) { anchor = position; count = 0; }
    last = position;
    count += 1;
  }
  close();

  return stops;
}

/**
 * @param resolvePlace injected so tests need no PostGIS. `findNearestPlace`
 *   itself returns null beyond `NEAREST_PLACE_MAX_M` (500 m), so a null answer
 *   already means "nowhere known"; the explicit radius comparison stays because
 *   the rule's `knownSiteRadiusMeters` is operator-editable and may be tightened
 *   below that cap.
 */
export async function detectUnauthorizedStops(
  ctx: VehicleDetectorContext, resolvePlace: PlaceResolver = findNearestPlace,
): Promise<DetectedVehicleEvent[]> {
  const median = medianGapSeconds(ctx.positions);
  if (median === null || median > DENSE_FEED_MAX_MEDIAN_GAP_SECONDS) return [];

  const events: DetectedVehicleEvent[] = [];
  for (const stop of findProlongedStops(ctx)) {
    const place = await resolvePlace(stop.lat, stop.lon);
    if (place && place.distanceM <= ctx.rule.knownSiteRadiusMeters) continue;

    events.push({
      detectorId: DETECTOR_ID,
      occurredAt: stop.startedAt,
      // The SAST DAY, not the observed start instant. A stop that began before
      // the window opened is anchored on the window's own moving edge, so the
      // instant slides forward every tick and mints a new incident each time.
      // See `calendarDayKey` for the measured repro and for what this guarantees
      // instead: at most one such incident per vehicle per SAST day.
      sourceEventId: buildSourceEventId(
        DETECTOR_ID, ctx.vehicle.vehicleId, calendarDayKey(stop.startedAt, ctx.rule),
      ),
      lat: stop.lat,
      lon: stop.lon,
      metadata: {
        vehicleRegistration: ctx.vehicle.registration,
        observedStartAt: stop.startedAt,
        // True when the stop extends past the window's oldest fix, i.e. it began
        // earlier than `stoppedMinutes` says and this is a floor, not a total.
        startClampedToWindow: stop.startClampedToWindow,
        stoppedMinutes: stop.minutes,
        thresholdMinutes: ctx.rule.unauthorizedStopMinutes,
        positionsInStop: stop.positionCount,
        lastFixAt: stop.endedAt,
        nearestPlaceLabel: place?.label ?? null,
        nearestPlaceDistanceMeters: place ? Math.round(place.distanceM) : null,
        knownSiteRadiusMeters: ctx.rule.knownSiteRadiusMeters,
        medianGapSeconds: Math.round(median),
        ruleVersion: ctx.rule.version,
      },
    });
  }
  return events;
}

/** The async detector shape `vehicleDetectorService` registers. */
export async function unauthorizedStopDetector(ctx: VehicleDetectorContext): Promise<DetectedVehicleEvent[]> {
  return detectUnauthorizedStops(ctx);
}

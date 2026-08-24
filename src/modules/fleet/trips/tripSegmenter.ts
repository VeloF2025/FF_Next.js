/**
 * Segments one vehicle's position stream into trips on ignition transitions.
 *
 * Pure: no SQL, no clock, no configuration lookup. Everything it needs - including "now" - is
 * passed in, so a re-run over the same window produces byte-identical output.
 *
 * ## The rule that matters
 *
 * A trip that never saw its ignition-off must never be indistinguishable from one that did.
 * Trackers go silent: the current data contains a 42.6 hour gap between consecutive positions,
 * and ituran averages 72 minutes between samples. If an open trip simply waited for its
 * off-event, one dead-zone morning would become a 42-hour trip - and that single row would poison
 * utilisation, average trip length and cost-per-km while looking entirely plausible.
 *
 * So a stale trip is closed at its LAST KNOWN position and timestamp, never at `now`, and it is
 * stamped `timeout`. The schema then excludes it from metrics via a generated column. A
 * confidently wrong number is worse than a visibly missing one.
 *
 * ## Null ignition is not a transition
 *
 * ituran leaves `ignition` null on ~6% of rows. A null is missing information, not "off" - so it
 * never opens or closes a trip. Treating it as a boundary would manufacture trips that did not
 * happen, which is the same class of error as the timeout case: invented data that reads as real.
 */

import { haversineDistance } from '../utils/geoUtils';

/** One position row, already narrowed to what segmentation needs. */
export interface TripPosition {
  recordedAt: string;
  ignition: boolean | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  odometerKm: number | null;
}

export type TripCloseReason = 'ignition_off' | 'timeout' | 'open';

export interface SegmentedTrip {
  ignitionOnAt: string;
  ignitionOffAt: string | null;
  closeReason: TripCloseReason;
  onLat: number | null;
  onLon: number | null;
  offLat: number | null;
  offLon: number | null;
  durationSeconds: number;
  movingSeconds: number;
  idleSeconds: number;
  distanceKm: number;
  maxSpeedKph: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  positionCount: number;
}

export interface SegmentOptions {
  /** No position for this long while a trip is open closes it as `timeout`. */
  stalenessTimeoutSeconds: number;
  /** At or below this speed a position counts as idling rather than moving. */
  idleSpeedThresholdKph: number;
  /** The instant the run is evaluated as of. Passed in so re-runs are deterministic. */
  now: string;
}

export const DEFAULT_SEGMENT_OPTIONS: Omit<SegmentOptions, 'now'> = {
  // 120 minutes: comfortably above ituran's 72-minute average sampling, low enough to catch
  // same-day silence. Configurable in settings so it can be tuned without a deploy.
  stalenessTimeoutSeconds: 120 * 60,
  idleSpeedThresholdKph: 2,
};

interface OpenTrip {
  onAt: string;
  onLat: number | null;
  onLon: number | null;
  startOdometer: number | null;
  lastAt: string;
  lastLat: number | null;
  lastLon: number | null;
  lastOdometer: number | null;
  movingSeconds: number;
  idleSeconds: number;
  distanceKm: number;
  maxSpeed: number | null;
  positionCount: number;
}

function seconds(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
}

function beginTrip(p: TripPosition): OpenTrip {
  return {
    onAt: p.recordedAt,
    onLat: p.lat,
    onLon: p.lon,
    startOdometer: p.odometerKm,
    lastAt: p.recordedAt,
    lastLat: p.lat,
    lastLon: p.lon,
    lastOdometer: p.odometerKm,
    movingSeconds: 0,
    idleSeconds: 0,
    distanceKm: 0,
    maxSpeed: p.speedKph,
    positionCount: 1,
  };
}

/**
 * Folds one position into the open trip.
 *
 * The interval since the previous position is attributed to moving or idling by the speed of the
 * position that CLOSES it, and distance accrues between consecutive fixes. A position missing its
 * coordinates still advances time - losing a fix is not the same as standing still.
 */
function extendTrip(trip: OpenTrip, p: TripPosition, options: SegmentOptions): void {
  const elapsed = seconds(trip.lastAt, p.recordedAt);
  const speed = p.speedKph ?? 0;
  if (speed > options.idleSpeedThresholdKph) trip.movingSeconds += elapsed;
  else trip.idleSeconds += elapsed;

  if (trip.lastLat !== null && trip.lastLon !== null && p.lat !== null && p.lon !== null) {
    // NOTE the property names: Coordinate is { lat, lon }. Passing { latitude, longitude } here
    // does not fail to compile against a structural type with optional-looking access, and
    // haversineDistance's identical-point early return then compares undefined === undefined and
    // answers 0 -- so every trip silently records zero distance. Caught by the distance test.
    trip.distanceKm += haversineDistance(
      { lat: trip.lastLat, lon: trip.lastLon },
      { lat: p.lat, lon: p.lon },
    );
  }

  if (p.speedKph !== null && (trip.maxSpeed === null || p.speedKph > trip.maxSpeed)) {
    trip.maxSpeed = p.speedKph;
  }
  if (p.odometerKm !== null) trip.lastOdometer = p.odometerKm;

  trip.lastAt = p.recordedAt;
  if (p.lat !== null && p.lon !== null) {
    trip.lastLat = p.lat;
    trip.lastLon = p.lon;
  }
  trip.positionCount += 1;
}

/**
 * Closes a trip.
 *
 * `at`/`lat`/`lon` are ALWAYS drawn from an observed position - the ignition-off fix for a genuine
 * end, or the last known fix for a timeout. Nothing here reads a clock.
 */
function closeTrip(trip: OpenTrip, reason: Exclude<TripCloseReason, 'open'>): SegmentedTrip {
  const startOdo = trip.startOdometer;
  const endOdo = trip.lastOdometer;
  return {
    ignitionOnAt: trip.onAt,
    ignitionOffAt: trip.lastAt,
    closeReason: reason,
    onLat: trip.onLat,
    onLon: trip.onLon,
    offLat: trip.lastLat,
    offLon: trip.lastLon,
    durationSeconds: seconds(trip.onAt, trip.lastAt),
    movingSeconds: trip.movingSeconds,
    idleSeconds: trip.idleSeconds,
    distanceKm: Math.round(trip.distanceKm * 100) / 100,
    maxSpeedKph: trip.maxSpeed,
    // An odometer that went backwards across the trip is a bad reading, not a negative journey.
    // Dropping the pair is honest; the schema would refuse it anyway.
    startOdometerKm: startOdo !== null && endOdo !== null && endOdo < startOdo ? null : startOdo,
    endOdometerKm: startOdo !== null && endOdo !== null && endOdo < startOdo ? null : endOdo,
    positionCount: trip.positionCount,
  };
}

function asOpen(trip: OpenTrip): SegmentedTrip {
  return {
    ...closeTrip(trip, 'ignition_off'),
    ignitionOffAt: null,
    closeReason: 'open',
    offLat: null,
    offLon: null,
  };
}

export interface SegmentResult {
  trips: SegmentedTrip[];
  /** The newest position consumed, for the caller's watermark. Null when none were. */
  lastPositionAt: string | null;
}

/**
 * Segments `positions` (one vehicle, ascending by `recordedAt`) into trips.
 *
 * `carriedOpen` is the trip left open by the previous run, so an incremental build continues a
 * journey rather than splitting it at the batch boundary.
 */
export function segmentTrips(
  positions: readonly TripPosition[],
  options: SegmentOptions,
  carriedOpen?: SegmentedTrip | null,
): SegmentResult {
  const trips: SegmentedTrip[] = [];
  let open: OpenTrip | null = null;

  if (carriedOpen && carriedOpen.closeReason === 'open') {
    open = {
      onAt: carriedOpen.ignitionOnAt,
      onLat: carriedOpen.onLat,
      onLon: carriedOpen.onLon,
      startOdometer: carriedOpen.startOdometerKm,
      lastAt: carriedOpen.ignitionOnAt,
      lastLat: carriedOpen.onLat,
      lastLon: carriedOpen.onLon,
      lastOdometer: carriedOpen.endOdometerKm,
      movingSeconds: carriedOpen.movingSeconds,
      idleSeconds: carriedOpen.idleSeconds,
      distanceKm: carriedOpen.distanceKm,
      maxSpeed: carriedOpen.maxSpeedKph,
      positionCount: carriedOpen.positionCount,
    };
  }

  for (const p of positions) {
    // A null ignition carries no transition. It still extends an open trip - the vehicle did not
    // stop existing - but it can neither start nor end one.
    if (p.ignition === null) {
      if (open) extendTrip(open, p, options);
      continue;
    }

    // Silence longer than the timeout ends the trip where it was last seen, not here.
    if (open && seconds(open.lastAt, p.recordedAt) > options.stalenessTimeoutSeconds) {
      trips.push(closeTrip(open, 'timeout'));
      open = null;
    }

    if (p.ignition) {
      // Note this is a sampled STATE, not a discrete event: while a vehicle runs, cartrack emits
      // ignition=true every few seconds. So consecutive true positions extend the current trip,
      // and a trip begins only on the transition into true - which is exactly the case where
      // nothing is open, either because the vehicle was parked or because the previous trip was
      // just closed by an ignition-off or a timeout above.
      if (!open) open = beginTrip(p);
      else extendTrip(open, p, options);
    } else if (open) {
      extendTrip(open, p, options);
      trips.push(closeTrip(open, 'ignition_off'));
      open = null;
    }
    // ignition false with no open trip: the vehicle is parked. Nothing to record.
  }

  if (open) {
    // Still open at the end of the batch. Whether that is "in progress" or "went silent" depends
    // on how long ago the last fix was - measured against the caller's `now`, never a real clock.
    const silentFor = seconds(open.lastAt, options.now);
    trips.push(
      silentFor > options.stalenessTimeoutSeconds ? closeTrip(open, 'timeout') : asOpen(open),
    );
  }

  return {
    trips,
    lastPositionAt: positions.length > 0 ? positions[positions.length - 1]!.recordedAt : null,
  };
}

/**
 * The incremental trip build: read positions since the watermark, segment, persist, advance.
 *
 * Vehicles are independent. One vehicle failing must not cost the others, because the alternative
 * is that a single bad tracker freezes the whole trip history — so each is caught on its own and
 * the RUN is reported as partial. A vehicle that fails keeps its old watermark and simply retries
 * the same window on the next tick.
 *
 * Batching exists so one vehicle with a long backlog cannot starve the rest: each vehicle is
 * advanced by at most `maxBatches` batches per run, and the backfill is the same code path run
 * repeatedly rather than a second implementation.
 */
import { log } from '@/lib/logger';
import {
  LATE_ARRIVAL_LOOKBACK_MINUTES, listVehiclesWithPositions, loadLastTripStart, loadPositions,
  readWatermark, replaceWindow, writeWatermark, type TrackedVehicle,
} from './tripRepository';
import { DEFAULT_SEGMENT_OPTIONS, segmentTrips, type SegmentOptions } from './tripSegmenter';

const MODULE = 'FleetTripBuild';

/** Positions read per batch. Bounded so one backlogged vehicle cannot monopolise a run. */
export const POSITION_BATCH_SIZE = 5000;

/** Batches per vehicle per run. `POSITION_BATCH_SIZE * this` is the per-run ceiling. */
export const MAX_BATCHES_PER_VEHICLE = 20;

/**
 * The staleness timeout, overridable without a code change via FLEET_TRIP_TIMEOUT_MINUTES.
 *
 * Deviation from the plan worth naming: the plan said "stored in settings". That would need
 * another settings table and migration for one number, so this reads an environment variable
 * instead. The practical difference is that changing it requires a service restart rather than a
 * settings write — if it turns out to need tuning per provider, promote it to a table then.
 */
function resolveTimeoutSeconds(): number {
  const raw = process.env.FLEET_TRIP_TIMEOUT_MINUTES;
  if (!raw) return DEFAULT_SEGMENT_OPTIONS.stalenessTimeoutSeconds;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    log.warn(
      '[fleet-trips] FLEET_TRIP_TIMEOUT_MINUTES is not a positive number; using the default',
      { raw }, MODULE,
    );
    return DEFAULT_SEGMENT_OPTIONS.stalenessTimeoutSeconds;
  }
  return Math.round(minutes * 60);
}

export interface VehicleBuildResult {
  vehicleId: string;
  tripsWritten: number;
  positionsProcessed: number;
  batches: number;
  /** True when the per-run ceiling stopped us short — there is more backlog to chew. */
  moreRemaining: boolean;
}

/**
 * The instant a rebuild should start reading from, or null to read from the beginning.
 *
 * Two floors, and the EARLIER wins:
 *
 *  - the late-arrival lookback before the watermark, which catches positions that were buffered
 *    out of coverage and flushed after the watermark had already passed them;
 *  - the start of the last trip already recorded, so the window never begins inside a journey.
 *
 * The second is the one that was missing. A bare time floor can land mid-trip, and the rebuild
 * then produces a trip with a different `ignition_on_at` -- the conflict key -- which INSERTs
 * beside the original rather than replacing it. One journey became three metric-eligible rows
 * across successive runs, each internally consistent and each wrong.
 *
 * Deliberately anchored on the last trip whatever its state, not just an open one: a trip closed
 * as `timeout` at a previous batch boundary must be reconsidered too, or it stays truncated.
 */
export function resolveReadFrom(watermark: string | null, lastTripStart: string | null): string | null {
  if (watermark === null) return null;
  const lookbackFloor = new Date(
    Date.parse(watermark) - LATE_ARRIVAL_LOOKBACK_MINUTES * 60_000,
  ).toISOString();
  if (lastTripStart === null) return lookbackFloor;
  return lastTripStart < lookbackFloor ? lastTripStart : lookbackFloor;
}

/**
 * Rebuilds trips for one vehicle from a trip-boundary-anchored window.
 *
 * Each batch REPLACES its window rather than adding to it: the window is cleared and the
 * recomputed trips inserted, so the outcome depends only on the positions. No accumulated state
 * crosses a batch, which is what makes re-processing idempotent instead of additive.
 */
export async function buildTripsForVehicle(
  vehicle: TrackedVehicle, options: SegmentOptions,
): Promise<VehicleBuildResult> {
  const watermark = await readWatermark(vehicle.vehicleId);
  const lastTripStart = await loadLastTripStart(vehicle.vehicleId);
  let readFrom = resolveReadFrom(watermark, lastTripStart);

  let tripsWritten = 0;
  let positionsProcessed = 0;
  let batches = 0;
  let moreRemaining = false;

  for (batches = 0; batches < MAX_BATCHES_PER_VEHICLE; batches += 1) {
    const positions = await loadPositions(vehicle.vehicleId, readFrom, POSITION_BATCH_SIZE);
    if (positions.length === 0) break;

    const { trips, lastPositionAt } = segmentTrips(positions, options);

    // Clear and rewrite as ONE transaction. Upserting alone cannot reap a row the rebuild no
    // longer produces -- a trip whose start moved, or one a longer view now shows was a fragment
    // -- but a delete that is not atomic with its rewrite is worse: a persistent insert failure
    // would clear the window on every tick and the vehicle's history would stay gone while
    // reading as a legitimate "no trips".
    const windowStart = readFrom ?? positions[0]!.recordedAt;
    const replaced = await replaceWindow(vehicle, windowStart, trips);
    tripsWritten += replaced.written;

    positionsProcessed += positions.length;
    if (lastPositionAt) {
      await writeWatermark(vehicle.vehicleId, lastPositionAt, positions.length);
    }

    if (positions.length < POSITION_BATCH_SIZE) break;

    // The next batch starts at the last trip this batch produced, so a journey straddling the
    // batch edge is recomputed whole rather than continued from summarised state. Falling back to
    // the last position only when the batch produced no trip at all.
    const lastTrip = trips[trips.length - 1];
    const nextFrom = lastTrip ? lastTrip.ignitionOnAt : lastPositionAt;
    if (nextFrom === null || (readFrom !== null && nextFrom <= readFrom)) {
      // No forward progress is possible -- a single trip larger than one batch. Stop rather than
      // spin re-reading the same window until the batch budget is gone.
      log.warn(
        '[fleet-trips] a single trip exceeds one batch; stopping this vehicle for the tick',
        { vehicleId: vehicle.vehicleId, readFrom, positions: positions.length },
        MODULE,
      );
      moreRemaining = true;
      break;
    }
    readFrom = nextFrom;
    if (batches === MAX_BATCHES_PER_VEHICLE - 1) moreRemaining = true;
  }

  return { vehicleId: vehicle.vehicleId, tripsWritten, positionsProcessed, batches, moreRemaining };
}

export interface TripBuildResult {
  status: 'succeeded' | 'partial' | 'failed';
  vehiclesRequested: number;
  vehiclesSucceeded: number;
  vehiclesFailed: number;
  tripsWritten: number;
  positionsProcessed: number;
  /** Vehicles still holding backlog after their per-run ceiling. */
  vehiclesWithBacklog: number;
  timeoutMinutes: number;
}

/** Builds trips for every vehicle that has positions. */
export async function buildTrips(requestedAt: string): Promise<TripBuildResult> {
  const stalenessTimeoutSeconds = resolveTimeoutSeconds();
  const options: SegmentOptions = {
    ...DEFAULT_SEGMENT_OPTIONS,
    stalenessTimeoutSeconds,
    now: requestedAt,
  };

  const vehicles = await listVehiclesWithPositions();
  let vehiclesSucceeded = 0;
  let vehiclesFailed = 0;
  let tripsWritten = 0;
  let positionsProcessed = 0;
  let vehiclesWithBacklog = 0;

  for (const vehicle of vehicles) {
    try {
      const result = await buildTripsForVehicle(vehicle, options);
      vehiclesSucceeded += 1;
      tripsWritten += result.tripsWritten;
      positionsProcessed += result.positionsProcessed;
      if (result.moreRemaining) vehiclesWithBacklog += 1;
    } catch (error) {
      vehiclesFailed += 1;
      // The watermark is untouched on failure, so the next run retries this exact window.
      //
      // This logs the raw message where the cron HANDLER deliberately logs only `error.name`, and
      // the difference is intentional. The handler is the outer boundary: it can catch anything,
      // including a pool-construction failure whose message embeds a connection string. Here the
      // errors are Postgres query errors from this vehicle's own statements, whose text ("relation
      // does not exist", "violates check constraint X") is the ONLY thing that makes a failing
      // vehicle diagnosable. Dropping it to `error.name` yields "Error" and nothing else.
      log.error(
        '[fleet-trips] vehicle build failed; its watermark is unchanged and it will retry',
        {
          vehicleId: vehicle.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        },
        MODULE,
      );
    }
  }

  const status = vehiclesFailed === 0
    ? 'succeeded'
    : vehiclesSucceeded === 0 ? 'failed' : 'partial';

  return {
    status,
    vehiclesRequested: vehicles.length,
    vehiclesSucceeded,
    vehiclesFailed,
    tripsWritten,
    positionsProcessed,
    vehiclesWithBacklog,
    timeoutMinutes: Math.round(stalenessTimeoutSeconds / 60),
  };
}

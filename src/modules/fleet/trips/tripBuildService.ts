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
  LATE_ARRIVAL_LOOKBACK_MINUTES, listVehiclesWithPositions, loadPositions, loadTripAnchorBefore,
  readWatermark, replaceWindow, writeWatermark, type TrackedVehicle,
} from './tripRepository';
import { DEFAULT_SEGMENT_OPTIONS, segmentTrips, type SegmentOptions } from './tripSegmenter';

const MODULE = 'FleetTripBuild';

/** Positions read per batch. Bounded so one backlogged vehicle cannot monopolise a run. */
/**
 * The advisory lock every trip builder takes, cron and backfill alike.
 *
 * Exported so the two callers cannot drift apart: two matching string literals in two files is a
 * silent-failure shape -- change one and the lock stops excluding anything while still appearing
 * to work.
 */
export const TRIP_BUILD_LOCK = 'fleet-build-trips';

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
 * How far back a rebuild reconsiders, before any trip-boundary anchoring.
 *
 * Catches positions buffered out of coverage and flushed after the watermark had already passed
 * them. Null watermark means the vehicle has never been built: read everything.
 */
export function lookbackFloor(watermark: string | null): string | null {
  if (watermark === null) return null;
  return new Date(Date.parse(watermark) - LATE_ARRIVAL_LOOKBACK_MINUTES * 60_000).toISOString();
}

/**
 * Where a rebuild window opens: the floor, pulled back to the start of whatever trip contains it.
 *
 * The anchor MUST be the last trip beginning at or before the floor. An earlier version took
 * `min(floor, lastTripStart)`, which selects the bare floor whenever the vehicle drove within the
 * lookback -- the normal case -- and a floor landing inside an older journey bisected it into two
 * metric-eligible trips, one nested in the other. See `loadTripAnchorBefore`.
 */
export function resolveReadFrom(floor: string | null, anchorBefore: string | null): string | null {
  if (floor === null) return null;
  return anchorBefore ?? floor;
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
  const floor = lookbackFloor(watermark);
  // The anchor is the trip that CONTAINS the floor, so the window never opens mid-journey.
  const anchor = floor === null ? null : await loadTripAnchorBefore(vehicle.vehicleId, floor);
  let readFrom = resolveReadFrom(floor, anchor);

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

    // A trip that STRADDLES the batch edge must be re-read from its own start, so the journey is
    // recomputed whole rather than continued from summarised state. What identifies a straddler
    // is not its close reason but whether the BATCH ended it: `ignitionOffAt === lastPositionAt`
    // means it was cut off by where we stopped reading, not by the vehicle switching off.
    //
    // Keying on `closeReason === 'open'` instead was wrong, and wrong precisely during backfill.
    // A trip still in progress at the batch edge is closed as `timeout`, not `open`, whenever its
    // last fix is older than the staleness timeout measured against `now` -- and in a backfill
    // `now` is the real clock against positions that are weeks old, so EVERY straddler is a
    // `timeout`. The next window then opened at the last POSITION, mid-journey, and one real
    // journey was stored as a truncated `timeout` half plus a second, metric-eligible
    // `ignition_off` trip beginning at a random point on a highway. 58 of them on real data,
    // understating fleet distance 1.6% at this batch size and 4.4% at 2,000 -- a wrong number
    // driven by a tuning constant rather than by the vehicles, and never repaired, because the
    // 6h lookback does not reach back that far.
    //
    // A trip the VEHICLE closed mid-batch is final, so the loop still advances past it and the
    // long-parked vehicle below does not stall.
    const lastTrip = trips[trips.length - 1];
    const straddlesBatchEdge = !!lastTrip
      && (lastTrip.closeReason === 'open' || lastTrip.ignitionOffAt === lastPositionAt);
    const nextFrom = straddlesBatchEdge ? lastTrip!.ignitionOnAt : lastPositionAt;
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

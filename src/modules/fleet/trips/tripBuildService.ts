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
  listVehiclesWithPositions, loadOpenTrip, loadPositions, readWatermark, upsertTrips,
  writeWatermark, type TrackedVehicle,
} from './tripRepository';
import {
  DEFAULT_SEGMENT_OPTIONS, segmentTrips, type SegmentedTrip, type SegmentOptions,
} from './tripSegmenter';

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
 * Builds trips for one vehicle from its watermark forward.
 *
 * The open trip is carried in memory across batches AND persisted each time, so a run that dies
 * midway leaves a consistent record rather than a journey with no beginning.
 */
export async function buildTripsForVehicle(
  vehicle: TrackedVehicle, options: SegmentOptions,
): Promise<VehicleBuildResult> {
  let carried: SegmentedTrip | null = await loadOpenTrip(vehicle.vehicleId);
  let watermark = await readWatermark(vehicle.vehicleId);
  let tripsWritten = 0;
  let positionsProcessed = 0;
  let batches = 0;
  let moreRemaining = false;

  for (batches = 0; batches < MAX_BATCHES_PER_VEHICLE; batches += 1) {
    const positions = await loadPositions(vehicle.vehicleId, watermark, POSITION_BATCH_SIZE);
    if (positions.length === 0) break;

    const { trips, lastPositionAt } = segmentTrips(positions, options, carried);
    if (trips.length > 0) {
      tripsWritten += await upsertTrips(vehicle, trips);
      const last = trips[trips.length - 1];
      carried = last && last.closeReason === 'open' ? last : null;
    }

    positionsProcessed += positions.length;
    if (lastPositionAt) {
      await writeWatermark(vehicle.vehicleId, lastPositionAt, positions.length);
      watermark = lastPositionAt;
    }

    // A short batch means we have caught up; anything else means more is waiting.
    if (positions.length < POSITION_BATCH_SIZE) break;
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

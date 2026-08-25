/**
 * The incremental vehicle-day stats build: read positions from a day boundary, fold, upsert,
 * advance the watermark.
 *
 * ## Why a window may only ever open at a SAST midnight
 *
 * A vehicle-day row is a FULL REPLACEMENT of everything known about that day. Fold half a day and
 * upsert it and you have overwritten a complete row with a partial one -- every column plausible,
 * every constraint satisfied, the distance simply smaller than it was an hour ago. The late-
 * arrival lookback is therefore never applied directly: it is snapped DOWN to the midnight that
 * opens the day containing it. This is the vehicle-day analogue of the trips builder's
 * trip-boundary anchor, and it exists for the same reason that one does.
 *
 * ## Today and yesterday are recomputed every tick, unconditionally
 *
 * Not because the watermark is untrusted, but because it cannot see a fix that has not arrived.
 * Trackers buffer out of coverage and flush late, and `received_at` routinely trails
 * `recorded_at`. A six-hour lookback covers most of that; opening at yesterday's midnight covers
 * the rest for the two days anyone is looking at.
 *
 * ## The ceiling stops a run at a DAY boundary, and only once it has gained ground
 *
 * `maxBatchesPerVehicle` bounds a tick so one backlogged vehicle cannot starve the fleet. But the
 * window always reopens at a midnight, so a run that stopped mid-day would reread the same
 * positions next tick and never advance. Stopping at the first day boundary is not enough either:
 * the six-hour lookback lands inside the day the watermark is already in, so a run that yields as
 * soon as ONE day closes closes the same day every tick, writes the same row every tick, and the
 * backlog is permanent and completely silent -- every run reports success.
 *
 * So a tick yields only once it has closed a day STRICTLY NEWER than the one its watermark sat
 * in. The still-open final day is withheld from the upsert and the watermark advances only to the
 * end of the last COMPLETE day, so forward progress is guaranteed at any batch size -- which is
 * what makes the batch-invariance sweep meaningful rather than merely green.
 *
 * ## The window's two edges are the caller's job
 *
 * The fold measures silence BETWEEN fixes, so it cannot see the hours before the first or after
 * the last. It takes both from the caller.
 *
 * `leadIn` is the last fix before the window opened, read once by `loadPositionBefore` and handed
 * to `createDayFold`. It is NOT fed through `addPositions`: the fold seeds it as the previous
 * position without counting it, so the interval crossing into the window's first day is measured
 * -- its silence, its distance, and whether that distance was CARRIED across an unattributable
 * gap. Without it the same date folds differently depending on how far back the run happened to
 * open, which is the batch-invariance defect arriving through the window instead of through the
 * batch.
 *
 * `windowEnd` is the instant the run reads at. It stops a day still in progress from being judged
 * on hours that have not happened yet and -- because `tailGapMs` clamps it to the day's own end --
 * still judges a CLOSED day on its full 24, so a tracker that died at noon cannot be reported as
 * a complete day.
 *
 * ## Failure is per vehicle
 *
 * One bad tracker must not freeze the fleet. A vehicle that throws keeps its old watermark, the
 * run is reported `partial`, and the same window is retried on the next tick. Because the upsert
 * is a full replacement, retrying costs nothing and repairs anything half-written.
 */
import { log } from '@/lib/logger';
import {
  listVehiclesWithPositions, loadPositionBefore, loadPositionsForWindow, loadTripsForWindow,
  readWatermark, upsertDayStats, writeWatermark, type PositionCursor,
} from './dailyStatsRepository';
import {
  daysReadyToWrite, lastClosedDay, windowEndFor, windowStartFor,
} from './dailyStatsWindow';
import { createDayFold } from './dayFold';
import { DAY_FOLD_POSITION_BATCH_SIZE } from './dayFoldOptions';
import type { DayFoldOptions } from './dayFoldOptions';
import { sastDay } from './dayIntervals';

const MODULE = 'FleetDailyStatsBuild';

/**
 * The advisory lock this job takes, cron and any future backfill alike.
 *
 * Exported so two callers cannot drift apart: two matching string literals in two files is a
 * silent-failure shape -- change one and the lock stops excluding anything while still appearing
 * to work. Shared with nothing else; the trip builder has its own.
 */
export const DAILY_STATS_LOCK = 'fleet-daily-stats';

/**
 * Positions read per page.
 *
 * The same 5,000 the fold documents: roughly four cartrack/velocity vehicle-days at that feed's
 * measured 1,169 fixes/day (max 3,047), so an ordinary tick is one page and a whole day never has
 * to be reassembled across a ceiling.
 */
export const POSITION_BATCH_SIZE = DAY_FOLD_POSITION_BATCH_SIZE;

/** Pages per vehicle per tick, before the run yields at the next day boundary. */
export const MAX_BATCHES_PER_VEHICLE = 20;

export interface DailyStatsBuildOptions {
  positionBatchSize: number;
  maxBatchesPerVehicle: number;
  foldOptions: Partial<DayFoldOptions>;
}

export const DEFAULT_BUILD_OPTIONS: DailyStatsBuildOptions = {
  positionBatchSize: POSITION_BATCH_SIZE,
  maxBatchesPerVehicle: MAX_BATCHES_PER_VEHICLE,
  foldOptions: {},
};

export interface VehicleStatsBuildResult {
  vehicleId: string;
  daysWritten: number;
  positionsProcessed: number;
  batches: number;
  /** True when the per-run ceiling stopped us short — there is more backlog to chew. */
  moreRemaining: boolean;
}

/** Folds one vehicle from its day-aligned window and persists whatever is complete. */
export async function buildStatsForVehicle(
  vehicleId: string, nowMs: number, options: DailyStatsBuildOptions,
): Promise<VehicleStatsBuildResult> {
  const watermark = await readWatermark(vehicleId);
  const windowStart = windowStartFor(watermark, nowMs);
  const watermarkDay = watermark === null ? null : sastDay(Date.parse(watermark));
  const firstWindowDay = windowStart === null ? null : sastDay(Date.parse(windowStart));

  // The interval that opened the window's first day can only be measured against the fix that
  // closed the previous one. Handed to the fold as its lead-in, never as a position.
  const leadIn = windowStart === null ? null : await loadPositionBefore(vehicleId, windowStart);
  const fold = createDayFold({ ...options.foldOptions, leadIn, windowEnd: windowEndFor(nowMs) });

  let cursor: PositionCursor | null = null;
  let positionsProcessed = 0;
  let batches = 0;
  let drained = false;
  const daysTouched = new Set<string>();

  for (;;) {
    const page = await loadPositionsForWindow(vehicleId, windowStart, cursor, options.positionBatchSize);
    if (page.length === 0) { drained = true; break; }

    fold.addPositions(page);
    positionsProcessed += page.length;
    batches += 1;
    const last = page[page.length - 1]!;
    cursor = { recordedAt: last.recordedAt, id: last.id };
    // First and last are enough to answer "has a second day appeared", which is all the ceiling
    // needs to know; the exact per-day split is taken from the fold's own output below.
    daysTouched.add(sastDay(Date.parse(page[0]!.recordedAt)));
    daysTouched.add(sastDay(Date.parse(last.recordedAt)));

    if (page.length < options.positionBatchSize) { drained = true; break; }
    if (batches < options.maxBatchesPerVehicle) continue;
    // Yield only once a day NEWER than the watermark's own has closed, or the next tick reopens
    // on the same day and the backlog never moves.
    const closed = lastClosedDay(daysTouched);
    if (closed !== null && (watermarkDay === null || closed > watermarkDay)) break;
  }

  fold.addTrips(await loadTripsForWindow(vehicleId, windowStart));

  const ready = daysReadyToWrite(fold.result(), drained, firstWindowDay);
  for (const day of ready) {
    await upsertDayStats(vehicleId, day);
  }

  // Only now, and only as far as the rows just written vouch for. Written first, a crash between
  // the two would leave the watermark asserting days that were never stored, and the lookback is
  // finite so nothing would ever go back for them.
  const advanceTo = ready.reduce<string | null>(
    (best, day) => (day.sourceWatermark !== null && (best === null || day.sourceWatermark > best)
      ? day.sourceWatermark : best),
    null,
  );
  if (advanceTo !== null) await writeWatermark(vehicleId, advanceTo, positionsProcessed);

  return {
    vehicleId,
    daysWritten: ready.length,
    positionsProcessed,
    batches,
    moreRemaining: !drained,
  };
}

export interface DailyStatsBuildResult {
  status: 'succeeded' | 'partial' | 'failed';
  vehiclesRequested: number;
  vehiclesSucceeded: number;
  vehiclesFailed: number;
  daysWritten: number;
  positionsProcessed: number;
  /** Vehicles still holding backlog after their per-run ceiling. */
  vehiclesWithBacklog: number;
}

/** Builds vehicle-day stats for every vehicle the position stream knows about. */
export async function buildDailyStats(
  requestedAt: string, overrides: Partial<DailyStatsBuildOptions> = {},
): Promise<DailyStatsBuildResult> {
  const options: DailyStatsBuildOptions = { ...DEFAULT_BUILD_OPTIONS, ...overrides };
  const nowMs = Date.parse(requestedAt);
  if (!Number.isFinite(nowMs)) throw new Error(`buildDailyStats: unparseable requestedAt ${requestedAt}`);

  const vehicles = await listVehiclesWithPositions();
  let vehiclesSucceeded = 0;
  let vehiclesFailed = 0;
  let daysWritten = 0;
  let positionsProcessed = 0;
  let vehiclesWithBacklog = 0;

  for (const vehicleId of vehicles) {
    try {
      const result = await buildStatsForVehicle(vehicleId, nowMs, options);
      vehiclesSucceeded += 1;
      daysWritten += result.daysWritten;
      positionsProcessed += result.positionsProcessed;
      if (result.moreRemaining) vehiclesWithBacklog += 1;
    } catch (error) {
      vehiclesFailed += 1;
      // The watermark is untouched on failure, so the next run retries this exact window. The raw
      // message is kept deliberately: these are this vehicle's own query errors, whose text is the
      // only thing that makes a failing tracker diagnosable. The cron HANDLER logs only
      // `error.name`, because it is the outer boundary and can catch a pool-construction failure
      // whose message embeds a connection string.
      log.error(
        '[fleet-daily-stats] vehicle build failed; its watermark is unchanged and it will retry',
        { vehicleId, error: error instanceof Error ? error.message : String(error) },
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
    daysWritten,
    positionsProcessed,
    vehiclesWithBacklog,
  };
}

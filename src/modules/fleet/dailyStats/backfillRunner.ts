/**
 * The vehicle-day stats backfill, as a testable module.
 *
 * `scripts/fleet-daily-stats-backfill.ts` is a thin shell around this: it takes the lock, calls
 * `runBackfill`, and exits. Everything with a right answer -- what the arguments mean, where a
 * refolded day's window opens and closes, which outcomes are failures -- lives here, because a
 * `scripts/` file is invisible to the test suite and to `tsc`.
 *
 * ## The same code path, never a second implementation
 *
 * Every fold and every write below goes through `buildDailyStats` / `buildStatsForVehicle`. This
 * file issues exactly one statement of its own -- the schema probe -- and holds no fold
 * arithmetic, no upsert, no knowledge of any column. Not tidiness: the trips backfill grew a
 * divergent bug by reimplementing its build, and the difference between the historical rows and
 * the live ones was invisible until someone reported on both together. A test in
 * `__tests__/backfillRunner.test.ts` reads this file's source and fails if SQL appears in it.
 *
 * ## Two modes, because the job has two different jobs
 *
 * **Drain** is the cron run repeatedly: each pass advances every vehicle by at least one closed
 * day and the run stops when no vehicle holds backlog. Safe to interrupt -- a pass either wrote
 * its days and advanced the watermark or did neither.
 *
 * **Refold** is the repair for the horizon the repository header names. A run reads from
 * `min(watermark - 6h, yesterday 00:00 SAST)` and that horizon only moves forward, so a tracker
 * dark for days that dumps its buffer on reconnection lands fixes the incremental job will never
 * look at again. `--refold-day` rebuilds one vehicle-day WHOLE -- its own midnight to the next,
 * lead-in read from before it -- through the same fold and the same full-replacement upsert.
 * Whole is the point: a window covering part of a day overwrites a complete row with a partial
 * one, every column plausible, the distance simply smaller than it was.
 *
 * There is deliberately no `--from <date>` sweep: the build service exposes no start parameter,
 * so a range would be a second window rule or a loop of refolds, and the loop is the honest one.
 */
import { queryOne } from '@/lib/db-pool';
import { buildDailyStats, buildStatsForVehicle, DEFAULT_BUILD_OPTIONS } from './dailyStatsBuildService';
import { dayStartMs, MS_PER_DAY } from './dayIntervals';

/** Passes before the run gives up and reports the backlog it could not clear. */
export const DEFAULT_MAX_PASSES = 50;

/** Tables migration 528 creates. Absent means the migration has not been applied here. */
export const REQUIRED_TABLES = ['fleet_vehicle_daily_stats', 'fleet_daily_stats_watermarks'] as const;

const WORK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BackfillArgs {
  mode: 'drain' | 'refold';
  /** Drain one vehicle instead of the fleet; required in refold mode. */
  vehicleId: string | null;

  refoldDay: string | null;
  maxPasses: number;
}

/** Where a refolded day opens and closes: its own SAST midnight to the next, and nothing else. */
export interface RefoldWindow { start: string; end: string }

export type BackfillReport = (line: string) => void;

export interface BackfillOutcome {
  passes: number;
  daysWritten: number;
  positionsProcessed: number;
  /** Non-zero when a vehicle failed or backlog outlived the pass ceiling. */
  exitCode: number;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let vehicleId: string | null = null;
  let refoldDay: string | null = null;
  let maxPasses = DEFAULT_MAX_PASSES;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--vehicle') { vehicleId = requireValue(argv, i + 1, flag); i += 1; continue; }
    if (flag === '--refold-day') { refoldDay = requireValue(argv, i + 1, flag); i += 1; continue; }
    if (flag === '--max-passes') {
      const raw = requireValue(argv, i + 1, flag);
      maxPasses = Number(raw);
      if (!Number.isInteger(maxPasses) || maxPasses < 1) throw new Error(`--max-passes must be a positive integer, got ${raw}`);
      i += 1; continue;
    }
    throw new Error(`unknown argument ${flag}`);
  }

  if (refoldDay !== null) {
    if (!WORK_DATE_RE.test(refoldDay)) throw new Error(`--refold-day must be YYYY-MM-DD, got ${refoldDay}`);
    // One vehicle-day is one vehicle AND one day; a fleet-wide refold is a full rescan in the
    // clothes of a repair.
    if (vehicleId === null) throw new Error('--refold-day requires --vehicle');
    return { mode: 'refold', vehicleId, refoldDay, maxPasses };
  }
  return { mode: 'drain', vehicleId, refoldDay: null, maxPasses };
}

/** `[midnight SAST, the next midnight SAST)` — exactly 24h, never truncated at the run instant. */
export function refoldWindow(workDate: string): RefoldWindow {
  const startMs = dayStartMs(workDate);
  if (!Number.isFinite(startMs)) throw new Error(`refoldWindow: unparseable work date ${workDate}`);
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + MS_PER_DAY).toISOString() };
}

/**
 * Refuses a day that has not finished: its window would end in the future, so the fold would
 * charge it silence for hours that have not happened and store that over what the cron had
 * correctly built. Today is the cron's business; this tool is for days it can no longer reach.
 */
export function assertDayClosed(workDate: string, nowMs: number): void {
  if (dayStartMs(workDate) + MS_PER_DAY > nowMs) {
    throw new Error(`${workDate} has not closed yet — refold only days that have ended (the cron owns today)`);
  }
}

/** Fails loudly when migration 528 is not applied on the database `DATABASE_URL` points at. */
export async function assertSchemaReady(): Promise<void> {
  for (const table of REQUIRED_TABLES) {
    const row = await queryOne<{ present: string | null }>(
      '/* fleet-daily-stats:schema-probe */ SELECT to_regclass($1)::text AS present',
      [`public.${table}`],
    );
    if (!row || row.present === null) {
      throw new Error(
        `${table} does not exist — migration 528 is not applied on this database. `
        + 'Apply scripts/migrations/sql/528_fleet_vehicle_daily_stats.sql before backfilling.',
      );
    }
  }
}

async function runRefold(args: BackfillArgs, report: BackfillReport, nowMs: number): Promise<BackfillOutcome> {
  const day = args.refoldDay!;
  assertDayClosed(day, nowMs);
  const window = refoldWindow(day);
  report(`refold ${day} (${window.start} → ${window.end}) vehicle ${args.vehicleId}`);
  const result = await buildStatsForVehicle(args.vehicleId!, nowMs, { ...DEFAULT_BUILD_OPTIONS, windowOverride: window });
  report(`  days ${result.daysWritten}  positions ${result.positionsProcessed}  batches ${result.batches}`);
  return { passes: 1, daysWritten: result.daysWritten, positionsProcessed: result.positionsProcessed, exitCode: 0 };
}

async function runDrainOneVehicle(args: BackfillArgs, report: BackfillReport, nowMs: () => number): Promise<BackfillOutcome> {
  let daysWritten = 0;
  let positionsProcessed = 0;
  for (let pass = 1; pass <= args.maxPasses; pass += 1) {
    const result = await buildStatsForVehicle(args.vehicleId!, nowMs(), DEFAULT_BUILD_OPTIONS);
    daysWritten += result.daysWritten;
    positionsProcessed += result.positionsProcessed;
    report(`pass ${String(pass).padStart(3)}  days +${result.daysWritten} (${daysWritten})  positions ${result.positionsProcessed}  backlog ${result.moreRemaining ? 1 : 0}`);
    if (!result.moreRemaining) return { passes: pass, daysWritten, positionsProcessed, exitCode: 0 };
  }
  report('hit the pass ceiling with backlog outstanding — re-run to continue');
  return { passes: args.maxPasses, daysWritten, positionsProcessed, exitCode: 1 };
}

async function runDrainFleet(args: BackfillArgs, report: BackfillReport, nowIso: () => string): Promise<BackfillOutcome> {
  let daysWritten = 0;
  let positionsProcessed = 0;
  let sawFailure = false;
  for (let pass = 1; pass <= args.maxPasses; pass += 1) {
    const result = await buildDailyStats(nowIso());
    daysWritten += result.daysWritten;
    positionsProcessed += result.positionsProcessed;
    if (result.vehiclesFailed > 0) sawFailure = true;
    report(
      `pass ${String(pass).padStart(3)}  vehicles ${result.vehiclesSucceeded}/${result.vehiclesRequested}  `
      + `days +${result.daysWritten} (${daysWritten})  positions ${result.positionsProcessed}  `
      + `backlog ${result.vehiclesWithBacklog}  status ${result.status}`,
    );
    // Every vehicle failing is a broken database or a missing grant, not a backlog: looping on it
    // burns the ceiling and buries the first error under 49 identical ones.
    if (result.status === 'failed') {
      report('every vehicle failed — stopping rather than looping on a broken state');
      return { passes: pass, daysWritten, positionsProcessed, exitCode: 1 };
    }
    // `vehiclesWithBacklog`, never `positionsProcessed === 0`: the six-hour lookback re-reads the
    // same tail every pass, so processed counts never reach zero on a live fleet.
    if (result.vehiclesWithBacklog === 0) {
      return { passes: pass, daysWritten, positionsProcessed, exitCode: sawFailure ? 1 : 0 };
    }
  }
  report('hit the pass ceiling with backlog outstanding — re-run to continue');
  return { passes: args.maxPasses, daysWritten, positionsProcessed, exitCode: 1 };
}

/** Drives the whole backfill. `clock` is injected so the tests are not racing a real one. */
export async function runBackfill(
  args: BackfillArgs, report: BackfillReport, clock: () => number = () => Date.now(),
): Promise<BackfillOutcome> {
  if (args.mode === 'refold') return runRefold(args, report, clock());
  if (args.vehicleId !== null) return runDrainOneVehicle(args, report, clock);
  return runDrainFleet(args, report, () => new Date(clock()).toISOString());
}

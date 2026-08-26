/**
 * The backfill's own logic: what the arguments mean, where a refolded day's window falls, and
 * which outcomes are failures.
 *
 * Two properties here are worth more than the rest.
 *
 * **The refold window must be a WHOLE day.** A vehicle-day row is a full replacement, so a window
 * covering part of a day upserts a partial row over a complete one -- every column plausible,
 * every constraint satisfied, the distance simply smaller than it was. The window is therefore
 * asserted on both edges AND on its duration, so a mutation that ends it at the run instant, at
 * noon, or at a UTC midnight fails rather than merely shifting a number nobody checks.
 *
 * **The backfill must not be a second implementation.** The trips backfill grew a divergent bug by
 * reimplementing its build; the guard at the foot of this file reads `backfillRunner.ts`'s source
 * and fails if it grows fold arithmetic or SQL of its own.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const service = vi.hoisted(() => ({
  buildDailyStats: vi.fn(),
  buildStatsForVehicle: vi.fn(),
  DEFAULT_BUILD_OPTIONS: {
    positionBatchSize: 5000, maxBatchesPerVehicle: 20, foldOptions: {}, windowOverride: null,
  },
  DAILY_STATS_LOCK: 'fleet-daily-stats',
}));
vi.mock('../dailyStatsBuildService', () => service);

const db = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import {
  assertDayClosed, assertSchemaReady, DEFAULT_MAX_PASSES, parseBackfillArgs, refoldWindow,
  runBackfill, REQUIRED_TABLES,
} from '../backfillRunner';
import { MS_PER_DAY } from '../dayIntervals';

const NOW_MS = Date.parse('2026-08-26T09:00:00+02:00');

/** A fleet pass result, defaulted to the drained/succeeded shape a test then perturbs. */
function pass(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'succeeded',
    vehiclesRequested: 3,
    vehiclesSucceeded: 3,
    vehiclesFailed: 0,
    daysWritten: 2,
    positionsProcessed: 100,
    vehiclesWithBacklog: 0,
    ...over,
  };
}

function vehiclePass(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { vehicleId: 'v1', daysWritten: 1, positionsProcessed: 50, batches: 1, moreRemaining: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.queryOne.mockResolvedValue({ present: 'fleet_vehicle_daily_stats' });
});

describe('parseBackfillArgs', () => {
  it('defaults to draining the whole fleet', () => {
    expect(parseBackfillArgs([])).toEqual({
      mode: 'drain', vehicleId: null, refoldDay: null, maxPasses: DEFAULT_MAX_PASSES,
    });
    expect(DEFAULT_MAX_PASSES).toBe(50);
  });

  it('takes a vehicle and a pass ceiling', () => {
    expect(parseBackfillArgs(['--vehicle', 'v1', '--max-passes', '7'])).toEqual({
      mode: 'drain', vehicleId: 'v1', refoldDay: null, maxPasses: 7,
    });
  });

  it('switches to refold mode only with a day AND a vehicle', () => {
    expect(parseBackfillArgs(['--vehicle', 'v1', '--refold-day', '2026-08-14']).mode).toBe('refold');
    // Fleet-wide refold is refused: it is a full-history rescan, not a repair.
    expect(() => parseBackfillArgs(['--refold-day', '2026-08-14'])).toThrow(/requires --vehicle/);
  });

  it('refuses malformed input rather than guessing', () => {
    expect(() => parseBackfillArgs(['--refold-day', '14/08/2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseBackfillArgs(['--max-passes', '0'])).toThrow(/positive integer/);
    expect(() => parseBackfillArgs(['--max-passes', 'ten'])).toThrow(/positive integer/);
    expect(() => parseBackfillArgs(['--from', '2026-08-01'])).toThrow(/unknown argument/);
    // A flag whose value was forgotten must not silently swallow the next flag as its value.
    expect(() => parseBackfillArgs(['--vehicle', '--max-passes', '3'])).toThrow(/needs a value/);
  });
});

describe('refoldWindow', () => {
  it('opens at the day OWN SAST midnight and closes at the next one', () => {
    expect(refoldWindow('2026-08-14')).toEqual({
      start: '2026-08-13T22:00:00.000Z', // 2026-08-14 00:00 SAST
      end: '2026-08-14T22:00:00.000Z', // 2026-08-15 00:00 SAST
    });
  });

  it('is exactly 24 hours wide — a partial window would overwrite a complete row', () => {
    for (const day of ['2026-01-01', '2026-08-14', '2026-12-31']) {
      const w = refoldWindow(day);
      expect(Date.parse(w.end) - Date.parse(w.start)).toBe(MS_PER_DAY);
      // SAST is UTC+2 with no DST, so both edges land at 22:00 UTC. A UTC-midnight window would
      // report 00:00Z here and silently fold two hours of the neighbouring day into this one.
      expect(w.start.endsWith('T22:00:00.000Z')).toBe(true);
      expect(w.end.endsWith('T22:00:00.000Z')).toBe(true);
    }
  });

  it('refuses a day that has not closed yet', () => {
    // Today, mid-morning: its window would end in the future and charge unlived hours as silence.
    expect(() => assertDayClosed('2026-08-26', NOW_MS)).toThrow(/has not closed/);
    // The instant the day closes is the first instant it may be refolded.
    expect(() => assertDayClosed('2026-08-25', Date.parse('2026-08-26T00:00:00+02:00'))).not.toThrow();
    expect(() => assertDayClosed('2026-08-25', Date.parse('2026-08-25T23:59:59+02:00'))).toThrow(/has not closed/);
  });
});

describe('assertSchemaReady', () => {
  it('probes every table migration 528 creates', async () => {
    await assertSchemaReady();
    expect(db.queryOne).toHaveBeenCalledTimes(REQUIRED_TABLES.length);
    const probed = db.queryOne.mock.calls.map((c) => (c[1] as string[])[0]);
    expect(probed).toEqual(REQUIRED_TABLES.map((t) => `public.${t}`));
  });

  it('refuses to run when the migration is not applied', async () => {
    db.queryOne.mockResolvedValue({ present: null });
    await expect(assertSchemaReady()).rejects.toThrow(/migration 528 is not applied/);
  });

  it('refuses when the probe returns no row at all', async () => {
    db.queryOne.mockResolvedValue(null);
    await expect(assertSchemaReady()).rejects.toThrow(/migration 528 is not applied/);
  });
});

describe('runBackfill — refold', () => {
  it('hands the service the whole-day window and nothing else', async () => {
    service.buildStatsForVehicle.mockResolvedValue(vehiclePass());
    const lines: string[] = [];
    const out = await runBackfill(
      parseBackfillArgs(['--vehicle', 'v1', '--refold-day', '2026-08-14']), (l) => lines.push(l), () => NOW_MS,
    );

    expect(service.buildStatsForVehicle).toHaveBeenCalledTimes(1);
    const [vehicleId, , options] = service.buildStatsForVehicle.mock.calls[0]!;
    expect(vehicleId).toBe('v1');
    expect((options as { windowOverride: unknown }).windowOverride).toEqual(refoldWindow('2026-08-14'));
    expect(out).toMatchObject({ passes: 1, daysWritten: 1, exitCode: 0 });
    expect(lines[0]).toContain('refold 2026-08-14');
  });

  it('never reaches the service for a day that has not closed', async () => {
    await expect(runBackfill(
      parseBackfillArgs(['--vehicle', 'v1', '--refold-day', '2026-08-26']), () => {}, () => NOW_MS,
    )).rejects.toThrow(/has not closed/);
    expect(service.buildStatsForVehicle).not.toHaveBeenCalled();
  });
});

describe('runBackfill — drain', () => {
  it('passes until no vehicle holds backlog', async () => {
    service.buildDailyStats
      .mockResolvedValueOnce(pass({ vehiclesWithBacklog: 3 }))
      .mockResolvedValueOnce(pass({ vehiclesWithBacklog: 1 }))
      .mockResolvedValueOnce(pass({ vehiclesWithBacklog: 0 }));
    const out = await runBackfill(parseBackfillArgs([]), () => {}, () => NOW_MS);
    expect(out).toMatchObject({ passes: 3, daysWritten: 6, exitCode: 0 });
  });

  it('exits non-zero when a vehicle failed, even once the fleet drained', async () => {
    // The status is `partial`, every other vehicle finished, and backlog reached zero — the whole
    // run still failed, because one vehicle's days were never written.
    service.buildDailyStats.mockResolvedValue(pass({ status: 'partial', vehiclesFailed: 1, vehiclesSucceeded: 2 }));
    const out = await runBackfill(parseBackfillArgs([]), () => {}, () => NOW_MS);
    expect(out.exitCode).toBe(1);
  });

  it('stops immediately when EVERY vehicle failed', async () => {
    service.buildDailyStats.mockResolvedValue(pass({ status: 'failed', vehiclesFailed: 3, vehiclesSucceeded: 0, vehiclesWithBacklog: 3 }));
    const out = await runBackfill(parseBackfillArgs(['--max-passes', '9']), () => {}, () => NOW_MS);
    expect(out).toMatchObject({ passes: 1, exitCode: 1 });
    expect(service.buildDailyStats).toHaveBeenCalledTimes(1);
  });

  it('exits non-zero when backlog outlives the pass ceiling', async () => {
    service.buildDailyStats.mockResolvedValue(pass({ vehiclesWithBacklog: 2 }));
    const lines: string[] = [];
    const out = await runBackfill(parseBackfillArgs(['--max-passes', '4']), (l) => lines.push(l), () => NOW_MS);
    expect(out).toMatchObject({ passes: 4, exitCode: 1 });
    expect(service.buildDailyStats).toHaveBeenCalledTimes(4);
    expect(lines.at(-1)).toContain('pass ceiling');
  });

  it('drains ONE vehicle through the same per-vehicle service entry', async () => {
    service.buildStatsForVehicle
      .mockResolvedValueOnce(vehiclePass({ moreRemaining: true }))
      .mockResolvedValueOnce(vehiclePass({ moreRemaining: false }));
    const out = await runBackfill(parseBackfillArgs(['--vehicle', 'v1']), () => {}, () => NOW_MS);

    expect(out).toMatchObject({ passes: 2, daysWritten: 2, exitCode: 0 });
    expect(service.buildDailyStats).not.toHaveBeenCalled();
    // A single-vehicle DRAIN derives its own window from the watermark like every other run.
    for (const call of service.buildStatsForVehicle.mock.calls) {
      expect((call[2] as { windowOverride: unknown }).windowOverride).toBeNull();
    }
  });
});

describe('the backfill is not a second implementation', () => {
  const source = readFileSync(join(__dirname, '..', 'backfillRunner.ts'), 'utf8');

  it('folds and writes only through the build service', () => {
    expect(source).toMatch(/from '\.\/dailyStatsBuildService'/);
    for (const symbol of ['buildDailyStats', 'buildStatsForVehicle']) {
      expect(source).toContain(symbol);
    }
    // Nothing that would let it compute a metric or write a row on its own.
    for (const forbidden of ['createDayFold', 'upsertDayStats', 'writeWatermark', 'dailyStatsSql', 'dailyStatsRepository']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('issues no SQL of its own beyond the schema probe', () => {
    const statements = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE|ON CONFLICT)\b/g)].map((m) => m[1]);
    // Exactly one, and it is the probe: anything else means fold or upsert SQL has been copied in.
    expect(statements).toEqual(['SELECT']);
    expect(source).toContain('SELECT to_regclass($1)::text AS present');
  });
});

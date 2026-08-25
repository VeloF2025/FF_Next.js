/**
 * The incremental vehicle-day build loop.
 *
 * What is tested here is not the fold -- that has its own suite -- but the properties whose
 * failure is SILENT: a window that opens mid-day and overwrites a complete row with a partial
 * one, a watermark that advances past rows that were never written, a vehicle whose failure
 * freezes the fleet, a backlog that never drains.
 *
 * Every test drives the real repository through `fakeDb`, a small engine that reads the operators
 * and the ON CONFLICT action out of the actual SQL. Mocking the repository instead would make
 * each of those mutations invisible.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/db-pool', () => ({
  query: (text: string, params: unknown[]) => (db.current as QueryLike).query(text, params),
  queryOne: (text: string, params: unknown[]) => (db.current as QueryLike).queryOne(text, params),
}));
const logger = vi.hoisted(() => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/logger', () => logger);

import { FakeDb } from './fakeDb';
import type { QueryLike } from './fakeDb';
import {
  ALPHA, BETA, DAYS, REQUESTED_AT, allPositions, alphaPositions, dayStart,
} from './statsFixtures';
import {
  buildDailyStats, daysReadyToWrite, MAX_BATCHES_PER_VEHICLE, POSITION_BATCH_SIZE, windowStartFor,
} from '../dailyStatsBuildService';
import { LATE_ARRIVAL_LOOKBACK_MINUTES } from '../dailyStatsRepository';

const NOW_MS = Date.parse(REQUESTED_AT);

function useDb(fake: FakeDb): FakeDb {
  db.current = fake;
  return fake;
}

/** Ticks the build until nothing is left, so a comparison is between finished states. */
async function runToCompletion(opts: Record<string, unknown> = {}, maxTicks = 40): Promise<number> {
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const result = await buildDailyStats(REQUESTED_AT, opts);
    if (result.status !== 'succeeded') throw new Error(`tick ${tick} reported ${result.status}`);
    if (result.vehiclesWithBacklog === 0) return tick;
  }
  throw new Error(`the build never drained in ${maxTicks} ticks`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDb(new FakeDb());
});

describe('windowStartFor', () => {
  it('reads everything when the vehicle has never been built', () => {
    expect(windowStartFor(null, NOW_MS)).toBeNull();
  });

  it('snaps the lookback floor DOWN to a SAST midnight, never opening mid-day', () => {
    // A watermark at 20:00 SAST minus the 6h lookback lands at 14:00 SAST — the middle of the
    // day. Opening there would fold half a day and upsert it over the complete row already
    // stored, silently shrinking every metric in it.
    const watermark = new Date(dayStart(DAYS[0]) + 20 * 3_600_000).toISOString();
    const start = windowStartFor(watermark, NOW_MS);
    expect(start).toBe(new Date(dayStart(DAYS[0])).toISOString());
    // The raw floor, which is what an unaligned window would use.
    expect(start).not.toBe(new Date(dayStart(DAYS[0]) + 14 * 3_600_000).toISOString());
  });

  it('re-opens the WHOLE of yesterday when the lookback reaches back into it', () => {
    // 03:00 SAST minus six hours is 21:00 the previous day. The affected day is re-opened at its
    // own midnight, not at 21:00 — a fix that arrived late for 10:00 yesterday is inside the day
    // the lookback touched, and a mid-day open would miss it.
    const watermark = new Date(dayStart(DAYS[2]) + 3 * 3_600_000).toISOString();
    expect(windowStartFor(watermark, Date.parse(`${DAYS[2]}T04:00:00+02:00`)))
      .toBe(new Date(dayStart(DAYS[1])).toISOString());
    expect(LATE_ARRIVAL_LOOKBACK_MINUTES).toBe(360);
  });

  it('always reaches back to YESTERDAY midnight even when the watermark is fresh', () => {
    // The watermark cannot see a fix that has not arrived yet. Without this branch a position
    // flushed late for yesterday afternoon — more than six hours behind a watermark that has
    // since moved into today — is never folded, and yesterday's row stays permanently short.
    //
    // The clock is deliberately mid-AFTERNOON. An earlier version of this test used an 06:00
    // watermark, where the six-hour lookback lands in yesterday ANYWAY — so the assertion held
    // with the yesterday branch deleted and proved nothing. It takes a watermark late enough in
    // the day for the lookback to stay inside it to tell the two rules apart.
    const now = Date.parse(`${DAYS[2]}T18:00:00+02:00`);
    const watermark = new Date(Date.parse(`${DAYS[2]}T17:00:00+02:00`)).toISOString();

    expect(windowStartFor(watermark, now)).toBe(new Date(dayStart(DAYS[1])).toISOString());
    // What the lookback alone would have chosen.
    expect(windowStartFor(watermark, now)).not.toBe(new Date(dayStart(DAYS[2])).toISOString());
  });

  it('uses the older of the two when the vehicle is behind', () => {
    const watermark = new Date(dayStart(DAYS[0]) + 12 * 3_600_000).toISOString();
    expect(windowStartFor(watermark, NOW_MS)).toBe(new Date(dayStart(DAYS[0])).toISOString());
  });
});

describe('daysReadyToWrite', () => {
  const day = (workDate: string, positionCount: number) => (
    { workDate, positionCount } as Parameters<typeof daysReadyToWrite>[0][number]
  );

  it('writes every folded day once the read drained', () => {
    const days = [day(DAYS[0], 3), day(DAYS[1], 4)];
    expect(daysReadyToWrite(days, true, null).map((d) => d.workDate)).toEqual([DAYS[0], DAYS[1]]);
  });

  it('withholds the still-open last day when the ceiling stopped the read', () => {
    const days = [day(DAYS[0], 3), day(DAYS[1], 4), day(DAYS[2], 1)];
    expect(daysReadyToWrite(days, false, null).map((d) => d.workDate)).toEqual([DAYS[0], DAYS[1]]);
  });

  it('writes nothing when not even one day finished', () => {
    expect(daysReadyToWrite([day(DAYS[0], 2)], false, null)).toEqual([]);
  });
});

describe('buildDailyStats', () => {
  it('pins the production batch constants', () => {
    // 5,000 is ~four cartrack/velocity vehicle-days at the measured 1,169 fixes/day, so an
    // ordinary tick is one page. Changing either is a decision, not a tweak.
    expect(POSITION_BATCH_SIZE).toBe(5_000);
    expect(MAX_BATCHES_PER_VEHICLE).toBe(20);
  });

  it('folds every vehicle-day in the fixture and advances each watermark', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(allPositions());

    const result = await buildDailyStats(REQUESTED_AT);

    expect(result.status).toBe('succeeded');
    expect(result.vehiclesRequested).toBe(2);
    expect(result.vehiclesWithBacklog).toBe(0);
    for (const workDate of DAYS) expect(fake.statsRow(ALPHA, workDate)).toBeDefined();
    expect(fake.watermarks.get(ALPHA)?.last_position_at).toBeTruthy();
    expect(logger.log.error).not.toHaveBeenCalled();
  });

  it('resumes from the watermark instead of rereading history', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(allPositions());
    await buildDailyStats(REQUESTED_AT);
    const firstPass = fake.executed.filter((e) => e.tag.startsWith('fleet-daily-stats:positions')).length;
    fake.executed = [];

    await buildDailyStats(REQUESTED_AT);

    // The second pass opens at yesterday's midnight rather than at the beginning of the stream,
    // so it asks a bounded question. It must also never fall back to the unbounded branch.
    const reads = fake.executed.filter((e) => e.tag.startsWith('fleet-daily-stats:positions'));
    expect(reads.length).toBeLessThanOrEqual(firstPass);
    expect(reads.some((e) => e.tag === 'fleet-daily-stats:positions-all')).toBe(false);
    const windowed = reads.filter((e) => e.tag === 'fleet-daily-stats:positions-window');
    expect(windowed.every((e) => String(e.params[1]) === new Date(dayStart(DAYS[2])).toISOString())).toBe(true);
  });

  it('changes no row when re-run over an already-built window', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(allPositions());
    await runToCompletion();
    const before = fake.statsHashes();

    await buildDailyStats(REQUESTED_AT);

    // computed_at is not in the fixture's stored row, so the digest is of the metrics alone.
    expect(fake.statsHashes()).toEqual(before);
  });

  it('picks up a position that arrived late for yesterday, with no watermark movement', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(allPositions());
    await runToCompletion();
    const beforeWatermark = fake.watermarks.get(ALPHA)?.last_position_at;
    const beforeCount = Number(fake.statsRow(ALPHA, DAYS[2])!.position_count);

    // Recorded mid-morning on the last fixture day, delivered now — hours behind the watermark.
    fake.seedPositions([{
      ...alphaPositions()[0]!,
      id: 'a-late-1',
      provider_event_id: 'ct-late-1',
      recorded_at: new Date(dayStart(DAYS[2]) + 10 * 3_600_000 + 1_000).toISOString(),
    }]);
    await buildDailyStats(REQUESTED_AT);

    expect(Number(fake.statsRow(ALPHA, DAYS[2])!.position_count)).toBe(beforeCount + 1);
    expect(fake.watermarks.get(ALPHA)?.last_position_at).toBe(beforeWatermark);
  });

  it('re-folds YESTERDAY for a fix that arrived far behind the watermark', async () => {
    // The behavioural half of the yesterday branch. The watermark sits at 17:00 today, so the
    // six-hour lookback reaches only 11:00 today — a fix recorded at 09:00 YESTERDAY is outside
    // it by many hours. Without the unconditional yesterday recompute that fix is never folded
    // and yesterday's row is permanently one short, with nothing anywhere reporting a problem.
    const fake = useDb(new FakeDb());
    const at = (day: string, hours: number) => new Date(dayStart(day) + hours * 3_600_000).toISOString();
    const fix = (n: number, recordedAt: string) => ({
      id: `y-${String(n).padStart(3, '0')}`,
      vehicle_id: ALPHA,
      recorded_at: recordedAt,
      provider_event_id: `ct-y-${n}`,
      provider: 'cartrack',
      account_ref: 'velocity',
      ignition: true,
      lat: -26.2,
      lon: 28.0,
      speed_kph: 30,
      is_speeding: false,
      odometer_km: 1_000 + n,
      linear_g: 0,
      lateral_g: 0,
      provider_event_type: 'PERIODIC_EVENT',
    });
    fake.seedPositions([
      fix(1, at(DAYS[1], 8)), fix(2, at(DAYS[1], 8.05)),
      fix(3, at(DAYS[2], 8)), fix(4, at(DAYS[2], 17)),
    ]);
    const now = at(DAYS[2], 18);
    await buildDailyStats(now);
    const before = Number(fake.statsRow(ALPHA, DAYS[1])!.position_count);
    expect(before).toBe(2);

    fake.seedPositions([fix(9, at(DAYS[1], 9))]);
    await buildDailyStats(now);

    expect(Number(fake.statsRow(ALPHA, DAYS[1])!.position_count)).toBe(3);
  });

  it('keeps one failing vehicle from costing the others, and leaves its watermark alone', async () => {
    const fake = useDb(new FakeDb({
      failOn: (tag, params) => (tag === 'fleet-daily-stats:upsert' && params[0] === ALPHA
        ? new Error('violates check constraint') : null),
    }));
    fake.seedPositions(allPositions());

    const result = await buildDailyStats(REQUESTED_AT);

    expect(result.status).toBe('partial');
    expect(result.vehiclesFailed).toBe(1);
    expect(result.vehiclesSucceeded).toBe(1);
    expect(fake.watermarks.has(ALPHA)).toBe(false);
    expect(fake.statsRow(BETA, DAYS[0])).toBeDefined();
    expect(logger.log.error).toHaveBeenCalledWith(
      expect.stringContaining('watermark is unchanged'),
      expect.objectContaining({ vehicleId: ALPHA }),
      expect.any(String),
    );
  });

  it('advances the watermark only AFTER the day rows are written', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(alphaPositions());

    await buildDailyStats(REQUESTED_AT);

    const tags = fake.executed.map((e) => e.tag);
    const lastUpsert = tags.lastIndexOf('fleet-daily-stats:upsert');
    const watermarkWrite = tags.indexOf('fleet-daily-stats:watermark-write');
    expect(lastUpsert).toBeGreaterThanOrEqual(0);
    expect(watermarkWrite).toBeGreaterThan(lastUpsert);
  });

  it('reports a backlog and withholds the unfinished day when the ceiling bites', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(alphaPositions());

    const result = await buildDailyStats(REQUESTED_AT, {
      positionBatchSize: 10, maxBatchesPerVehicle: 2,
    });

    expect(result.vehiclesWithBacklog).toBe(1);
    // The ceiling stops the run at a DAY boundary, so the first day is complete and stored while
    // the day the run was still inside is not. A partial row written here would be indeterminate
    // in exactly the way the batch sweep exists to rule out.
    expect(fake.statsRow(ALPHA, DAYS[0])).toBeDefined();
    expect(fake.statsRow(ALPHA, DAYS[1])).toBeUndefined();
  });

  it('drains a backlog over successive ticks at a batch size that splits a vehicle-day', async () => {
    const fake = useDb(new FakeDb());
    fake.seedPositions(alphaPositions());

    const ticks = await runToCompletion({ positionBatchSize: 50, maxBatchesPerVehicle: 2 });

    expect(ticks).toBeGreaterThan(1);
    for (const workDate of DAYS) expect(fake.statsRow(ALPHA, workDate)).toBeDefined();
  });
});

/**
 * The sweep R1 makes mandatory: the same fixture, built at five batch sizes, must yield the same
 * rows.
 *
 * The trips builder shipped a straddler bug that six reviewers read past. It understated fleet
 * distance 1.6% at one batch size and 4.4% at another, every row internally consistent and every
 * constraint satisfied. Reading cannot find that class of defect; running the same input at
 * several batch sizes and comparing the output can, and is the only thing that did.
 *
 * The comparison runs through `fakeDb`, which reads the operators and the ON CONFLICT action out
 * of the real SQL, so the pager and the upsert are under test here rather than mocked away.
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
import { ALPHA, DAYS, REQUESTED_AT, allPositions, alphaPositions, dayStart } from './statsFixtures';
import { buildDailyStats, POSITION_BATCH_SIZE } from '../dailyStatsBuildService';
import { UPSERT_SQL } from '../dailyStatsSql';

/**
 * 1 and the production 5,000 are required by R1. 50 and 137 split a vehicle-day at an awkward
 * offset, 360 lands exactly on the fixture's day length so a page boundary coincides with a
 * midnight -- the case a fold that leaned on page edges would get wrong.
 */
const BATCH_SIZES = [1, 50, 137, 360, POSITION_BATCH_SIZE];

async function buildAt(batchSize: number): Promise<FakeDb> {
  const fake = new FakeDb();
  db.current = fake;
  fake.seedPositions(allPositions());
  for (let tick = 0; tick < 60; tick += 1) {
    const result = await buildDailyStats(REQUESTED_AT, { positionBatchSize: batchSize });
    expect(result.status).toBe('succeeded');
    if (result.vehiclesWithBacklog === 0) return fake;
  }
  throw new Error(`batch size ${batchSize} never drained`);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('batch-size invariance', () => {
  it('produces byte-identical rows at 1 / 50 / 137 / 360 / 5000', async () => {
    const reference = (await buildAt(BATCH_SIZES[0]!)).statsHashes();
    // Non-vacuity: the sweep must be comparing real rows, not two empty maps.
    expect(reference.size).toBe(6);
    expect([...reference.values()].every((v) => v.includes('position_count='))).toBe(true);

    for (const size of BATCH_SIZES.slice(1)) {
      const hashes = (await buildAt(size)).statsHashes();
      expect({ size, hashes }).toEqual({ size, hashes: reference });
    }
    expect(logger.log.error).not.toHaveBeenCalled();
  }, 60_000);
});

describe('the read cursor is exclusive on the FIX', () => {
  it('keeps both fixes of a same-instant pair when a page boundary falls between them', async () => {
    // Production holds 164 such groups over 7 days, on all seven cartrack/velocity vehicles:
    // distinct provider_event_ids at one instant, sometimes disagreeing about ignition. At batch
    // size 1 every boundary falls between two fixes, so this pair is split across pages.
    //
    // A bare `recorded_at >` cursor DROPS the second twin and this count is one short. An
    // inclusive `>=` cursor re-feeds the first, the fold's duplicate guard throws, the vehicle is
    // reported failed and the day is never written at all. The count and the clean log together
    // distinguish all three outcomes.
    const fake = await buildAt(1);

    expect(Number(fake.statsRow(ALPHA, DAYS[1])!.position_count)).toBe(361);
    expect(Number(fake.statsRow(ALPHA, DAYS[0])!.position_count)).toBe(360);
    expect(logger.log.error).not.toHaveBeenCalled();
  }, 60_000);
});

describe('the upsert REPLACES the row', () => {
  it('rewrites a day that was already built when its positions change', async () => {
    const fake = new FakeDb();
    db.current = fake;
    fake.seedPositions(alphaPositions());
    await buildDailyStats(REQUESTED_AT);
    const before = { ...fake.statsRow(ALPHA, DAYS[2])! };

    // Three more fixes for a day already stored, arriving late.
    const template = alphaPositions()[200]!;
    fake.seedPositions([0, 1, 2].map((n) => ({
      ...template,
      id: `a-late-${n}`,
      provider_event_id: `ct-late-${n}`,
      recorded_at: new Date(dayStart(DAYS[2]) + 11 * 3_600_000 + n * 60_000).toISOString(),
      odometer_km: 99_000 + n,
      speed_kph: 91,
      is_speeding: true,
    })));
    await buildDailyStats(REQUESTED_AT);
    const after = fake.statsRow(ALPHA, DAYS[2])!;

    // ON CONFLICT DO NOTHING would leave every one of these at its first-computed value, and the
    // FIRST computation of today is always partial — so the frozen row is the normal case.
    expect(Number(after.position_count)).toBe(Number(before.position_count) + 3);
    expect(Number(after.distance_km)).not.toBe(Number(before.distance_km));
    expect(Number(after.max_speed_kph)).not.toBe(Number(before.max_speed_kph));
  });

  it('assigns EVERY non-key column from EXCLUDED', () => {
    // A column quietly dropped from the SET list keeps whichever partial fold inserted the row —
    // one stale number beside fresh ones, in a row no constraint can reject. The expected list is
    // derived from the statement's own INSERT columns rather than copied, so adding a column
    // without an assignment fails here instead of shipping.
    const inserted = /INSERT INTO \w+\s*\(([^)]*)\)/.exec(UPSERT_SQL)![1]!
      .split(',').map((c) => c.trim()).filter(Boolean);
    const assigned = new Set(
      [...UPSERT_SQL.matchAll(/(\w+)\s*=\s*EXCLUDED\.(\w+)/g)].map((m) => `${m[1]}->${m[2]}`),
    );
    const keys = ['vehicle_id', 'work_date'];
    const metrics = inserted.filter((c) => !keys.includes(c));

    expect(metrics.length).toBeGreaterThanOrEqual(20);
    expect(metrics.filter((c) => !assigned.has(`${c}->${c}`))).toEqual([]);
    expect(/ON CONFLICT \(vehicle_id, work_date\) DO UPDATE/.test(UPSERT_SQL)).toBe(true);
  });
});

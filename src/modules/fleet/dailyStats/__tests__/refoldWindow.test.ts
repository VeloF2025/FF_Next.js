/**
 * The refold window, driven through the REAL fold, the real repository and the real SQL.
 *
 * `backfillRunner.test.ts` proves the window's arithmetic against a mocked service. That cannot
 * see what the window does to a stored row, which is the whole point of the mode — so these tests
 * build the fixture the ordinary way first, then refold a day and compare what is in the table.
 *
 * Two properties:
 *
 * 1. **Refolding a closed day changes nothing.** If it did, either the incremental build or the
 *    refold is wrong about that day, and there is no way to tell which from the row alone.
 * 2. **A window that is not a WHOLE day silently shrinks the row it replaces.** This is the reason
 *    `refoldWindow` pins both edges. The mutation is applied here directly — a half-day window is
 *    passed to the same service — and the row it produces is asserted to be both DIFFERENT and
 *    SMALLER, so a `refoldWindow` that ever returned one would fail on the consequence rather
 *    than on a string comparison.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/db-pool', () => ({
  query: (text: string, params: unknown[]) => (db.current as QueryLike).query(text, params),
  queryOne: (text: string, params: unknown[]) => (db.current as QueryLike).queryOne(text, params),
}));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { FakeDb } from './fakeDb';
import type { FakePositionRow, QueryLike } from './fakeDb';
import { ALPHA, DAYS, REQUESTED_AT, alphaPositions, dayStart } from './statsFixtures';
import { refoldWindow } from '../backfillRunner';
import { buildDailyStats, buildStatsForVehicle, DEFAULT_BUILD_OPTIONS } from '../dailyStatsBuildService';
import { MS_PER_DAY } from '../dayIntervals';

const NOW_MS = Date.parse(REQUESTED_AT);
let fake: FakeDb;

/** Runs the ordinary incremental build until nothing is left, as the cron would. */
async function drain(): Promise<void> {
  for (let tick = 1; tick <= 20; tick += 1) {
    const result = await buildDailyStats(REQUESTED_AT);
    if (result.status !== 'succeeded') throw new Error(`tick ${tick} reported ${result.status}`);
    if (result.vehiclesWithBacklog === 0) return;
  }
  throw new Error('the build never drained');
}

/** A late-arriving fix on the FIRST fixture day — older than the horizon a run reaches back to. */
function lateFix(): FakePositionRow {
  return {
    id: 'a-late-0001',
    vehicle_id: ALPHA,
    recorded_at: new Date(dayStart(DAYS[0]) + 12 * 3_600_000 + 137_000).toISOString(),
    provider_event_id: 'ct-late-0001',
    provider: 'cartrack',
    account_ref: 'velocity',
    ignition: true,
    lat: -26.9,
    lon: 28.9,
    speed_kph: 64,
    is_speeding: false,
    odometer_km: 10_500,
    linear_g: 0,
    lateral_g: 0,
    provider_event_type: 'PERIODIC_EVENT',
  };
}

function metrics(workDate: string): Record<string, unknown> {
  const row = fake.statsRow(ALPHA, workDate);
  if (!row) throw new Error(`no stored row for ${workDate}`);
  const { computed_at: _ignored, ...rest } = row;
  return rest;
}

async function refold(workDate: string, window = refoldWindow(workDate)): Promise<void> {
  await buildStatsForVehicle(ALPHA, NOW_MS, { ...DEFAULT_BUILD_OPTIONS, windowOverride: window });
}

beforeEach(async () => {
  vi.clearAllMocks();
  fake = new FakeDb();
  fake.seedPositions(alphaPositions());
  db.current = fake;
  await drain();
});

describe('refolding a whole day', () => {
  it('leaves a correctly built day byte-identical', async () => {
    const before = metrics(DAYS[1]);
    await refold(DAYS[1]);
    expect(metrics(DAYS[1])).toEqual(before);
  });

  it('does not disturb the neighbouring days', async () => {
    const before = [metrics(DAYS[0]), metrics(DAYS[2])];
    await refold(DAYS[1]);
    expect([metrics(DAYS[0]), metrics(DAYS[2])]).toEqual(before);
  });

  it('cannot rewind the watermark it walks behind', async () => {
    const before = fake.watermarks.get(ALPHA)?.last_position_at;
    await refold(DAYS[0]);
    expect(fake.watermarks.get(ALPHA)?.last_position_at).toBe(before);
  });

  it('repairs a fix that arrived older than the horizon the cron reaches back to', async () => {
    // The incremental build cannot see it: its window opens at `min(watermark - 6h, yesterday
    // 00:00 SAST)`, and that horizon has long passed this day. Another drain proves it.
    const stale = metrics(DAYS[0]);
    fake.seedPositions([lateFix()]);
    await drain();
    expect(metrics(DAYS[0])).toEqual(stale);

    // The refold is the documented repair, and it is a full replacement rather than an addition.
    await refold(DAYS[0]);
    const repaired = metrics(DAYS[0]);
    expect(repaired.position_count).toBe(Number(stale.position_count) + 1);
    expect(repaired).not.toEqual(stale);
  });
});

describe('a window that is not a whole day', () => {
  it('overwrites a complete row with a smaller one — which is why both edges are pinned', async () => {
    const complete = metrics(DAYS[1]);
    const start = dayStart(DAYS[1]);

    // The mutation: the same day, the same service, a window truncated at midday.
    await refold(DAYS[1], {
      start: new Date(start).toISOString(),
      end: new Date(start + MS_PER_DAY / 2).toISOString(),
    });

    const partial = metrics(DAYS[1]);
    expect(partial).not.toEqual(complete);
    expect(Number(partial.position_count)).toBeLessThan(Number(complete.position_count));
    expect(Number(partial.distance_km)).toBeLessThan(Number(complete.distance_km));

    // And it is repairable — the row is a function of the window, not of what was there before.
    await refold(DAYS[1]);
    expect(metrics(DAYS[1])).toEqual(complete);
  });

  it('opened mid-day, it loses the morning entirely', async () => {
    const complete = metrics(DAYS[1]);
    const start = dayStart(DAYS[1]);
    await refold(DAYS[1], {
      start: new Date(start + MS_PER_DAY / 2).toISOString(),
      end: new Date(start + MS_PER_DAY).toISOString(),
    });
    expect(Number(metrics(DAYS[1]).position_count)).toBeLessThan(Number(complete.position_count));
  });
});

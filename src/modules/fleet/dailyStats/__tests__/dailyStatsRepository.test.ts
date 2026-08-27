/**
 * The statements themselves, exercised directly rather than through the build loop.
 *
 * Three of these pin boundaries that the row cannot show. A trip closing exactly at the window's
 * first instant contributes only to days the write filter drops, so `>=` and `>` on that bound
 * produce identical rows -- the difference is real in the query and invisible downstream, which is
 * exactly the shape a service-level test cannot catch. Asserting on what the repository RETURNS
 * closes that gap without pretending the row would have shown it.
 *
 * Driven by `fakeDb`, which reads the comparison operators out of the SQL it is handed, so
 * mutating an operator mutates what these tests see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/db-pool', () => ({
  query: (text: string, params: unknown[]) => (db.current as QueryLike).query(text, params),
  queryOne: (text: string, params: unknown[]) => (db.current as QueryLike).queryOne(text, params),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { FakeDb } from './fakeDb';
import type { QueryLike } from './fakeDb';
import { DAYS, dayStart } from './statsFixtures';
import {
  loadPositionsForWindow, loadTripsForWindow, readWatermark, writeWatermark,
} from '../dailyStatsRepository';

const at = (day: string, seconds: number) => new Date(dayStart(day) + seconds * 1_000).toISOString();
const WINDOW_START = at(DAYS[1], 0);
const WINDOW_END = at(DAYS[2], 18 * 3_600);

let fake: FakeDb;

function position(id: string, recordedAt: string) {
  return {
    id,
    vehicle_id: 'v1',
    recorded_at: recordedAt,
    provider_event_id: `e-${id}`,
    provider: 'cartrack',
    account_ref: 'velocity',
    ignition: true,
    lat: -26.2,
    lon: 28.0,
    speed_kph: 30,
    is_speeding: false,
    odometer_km: 100,
    linear_g: 0,
    lateral_g: 0,
    provider_event_type: 'PERIODIC_EVENT',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = new FakeDb();
  db.current = fake;
});

describe('loadPositionsForWindow', () => {
  it('returns a fix recorded exactly AT the window end, and none after it', async () => {
    // The upper bound is what stops a tracker whose clock runs ahead of the server from handing
    // the fold a fix newer than the window it was told about — which `assertWindowCoversLastFix`
    // rejects, failing that vehicle on every tick for as long as the clock stays skewed.
    fake.seedPositions([
      position('p1', at(DAYS[2], 17 * 3_600)),
      position('p2', WINDOW_END),
      position('p3', at(DAYS[2], 18 * 3_600 + 30)),
    ]);

    const rows = await loadPositionsForWindow('v1', WINDOW_START, null, WINDOW_END, 100);

    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('applies the window end to the CURSOR branch too, not only the first page', async () => {
    // The pages after the first are where a long backlog spends its time, so a bound applied only
    // to the opening query would leave the hazard in place for every vehicle that has one.
    fake.seedPositions([
      position('p1', at(DAYS[2], 16 * 3_600)),
      position('p2', at(DAYS[2], 17 * 3_600)),
      position('p3', at(DAYS[2], 19 * 3_600)),
    ]);

    const rows = await loadPositionsForWindow(
      'v1', WINDOW_START, { recordedAt: at(DAYS[2], 16 * 3_600), id: 'p1' }, WINDOW_END, 100,
    );

    expect(rows.map((r) => r.id)).toEqual(['p2']);
  });

  it('applies the window end on the unbounded branch, for a never-built vehicle', async () => {
    fake.seedPositions([position('p1', at(DAYS[0], 3_600)), position('p2', at(DAYS[2], 19 * 3_600))]);

    const rows = await loadPositionsForWindow('v1', null, null, WINDOW_END, 100);

    expect(rows.map((r) => r.id)).toEqual(['p1']);
  });
});

describe('loadTripsForWindow', () => {
  const trip = (onAt: string, offAt: string | null) => (
    { vehicle_id: 'v1', ignition_on_at: onAt, ignition_off_at: offAt }
  );

  it('includes a trip closing exactly AT the window start', async () => {
    // Inclusive by design. This bound is asserted here rather than through a stats row because a
    // trip closing at the window's first instant apportions its whole self to days BEFORE the
    // window, which the write filter drops — so the row is identical either way and only the
    // query can show the difference.
    fake.trips.push(trip(at(DAYS[0], 22 * 3_600), WINDOW_START));

    const trips = await loadTripsForWindow('v1', WINDOW_START, WINDOW_END);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.ignitionOffAt).toBe(new Date(WINDOW_START).toISOString());
  });

  it('includes a trip closing exactly AT the window end, and excludes one closing after it', async () => {
    fake.trips.push(trip(at(DAYS[2], 17 * 3_600), WINDOW_END));
    fake.trips.push(trip(at(DAYS[2], 18 * 3_600), at(DAYS[2], 19 * 3_600)));

    const trips = await loadTripsForWindow('v1', WINDOW_START, WINDOW_END);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.ignitionOffAt).toBe(new Date(WINDOW_END).toISOString());
  });

  it('excludes a trip that closed before the window opened', async () => {
    fake.trips.push(trip(at(DAYS[0], 20 * 3_600), at(DAYS[0], 21 * 3_600)));

    expect(await loadTripsForWindow('v1', WINDOW_START, WINDOW_END)).toEqual([]);
  });

  it('still bounds the top when there is no window start', async () => {
    fake.trips.push(trip(at(DAYS[0], 20 * 3_600), at(DAYS[0], 21 * 3_600)));
    fake.trips.push(trip(at(DAYS[2], 18 * 3_600), at(DAYS[2], 19 * 3_600)));

    const trips = await loadTripsForWindow('v1', null, WINDOW_END);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.ignitionOffAt).toBe(new Date(at(DAYS[0], 21 * 3_600)).toISOString());
  });

  it('ignores an open trip, which has no bounded ignition period', async () => {
    fake.trips.push(trip(at(DAYS[1], 8 * 3_600), null));

    expect(await loadTripsForWindow('v1', WINDOW_START, WINDOW_END)).toEqual([]);
  });
});

describe('writeWatermark', () => {
  it('never rewinds: an older instant leaves the mark where it was', async () => {
    // GREATEST is not defensive decoration. The build service cannot itself produce a rewind --
    // its ceiling only yields once a day NEWER than the watermark's own has closed -- but two
    // callers can: a retention sweep that prunes the positions a mark was derived from, and PR9's
    // backfill, which walks older windows on purpose. Without this, either one silently drags the
    // mark backwards and the next tick refolds ground already covered, forever.
    await writeWatermark('v1', at(DAYS[2], 20 * 3_600), 10);
    await writeWatermark('v1', at(DAYS[1], 6 * 3_600), 5);

    expect(await readWatermark('v1')).toBe(new Date(at(DAYS[2], 20 * 3_600)).toISOString());
  });

  it('advances on a newer instant, and accumulates the processed count', async () => {
    // The non-vacuity half: the guard must not be "never move at all".
    await writeWatermark('v1', at(DAYS[1], 6 * 3_600), 5);
    await writeWatermark('v1', at(DAYS[2], 20 * 3_600), 10);

    expect(await readWatermark('v1')).toBe(new Date(at(DAYS[2], 20 * 3_600)).toISOString());
    expect(Number(fake.watermarks.get('v1')!.positions_processed)).toBe(15);
  });

  it('returns null for a vehicle that has never been built', async () => {
    expect(await readWatermark('v1')).toBeNull();
  });
});

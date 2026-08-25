/**
 * The fold must not care how its input was paged.
 *
 * This file is mandatory rather than nice-to-have, and the reason is on the record: the trips
 * builder shipped a straddler bug that six code reviewers read past. It understated fleet distance
 * by 1.6% at one batch size and 4.4% at another, every row passed every constraint, and nothing in
 * the data looked wrong. Only running the same input at several batch sizes and comparing the
 * output byte for byte found it.
 *
 * So the assertion is a hash of the WHOLE row, not a spot check of a field someone thought to
 * look at. A new column added to VehicleDayStats is covered the day it is added, because the hash
 * is built from the row's own keys.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDayFold, foldVehicleDays } from '../dayFold';
import { DAY_FOLD_POSITION_BATCH_SIZE } from '../dayFoldOptions';
import type { DayPosition, VehicleDayStats } from '../types';
import { fix, ituranDayWithLongSilence, netstarDay, urentDay, velocityRun } from './fixtures';

/**
 * A canonical hash of one row: every key, sorted, with its value.
 *
 * Built from `Object.keys` rather than a hand-written field list precisely so that it cannot fall
 * behind the type -- a hand-written list is a copy of the rule, and a copy is what stops testing
 * the rule the moment the rule changes.
 */
function rowHash(row: VehicleDayStats): string {
  const canonical = Object.keys(row)
    .sort()
    .map((key) => `${key}=${String((row as unknown as Record<string, unknown>)[key])}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

function foldInBatches(positions: readonly DayPosition[], batchSize: number): VehicleDayStats[] {
  const fold = createDayFold();
  for (let i = 0; i < positions.length; i += batchSize) {
    fold.addPositions(positions.slice(i, i + batchSize));
  }
  return fold.result();
}

/**
 * 1 and 2 catch a fold that needs two positions in hand; 3 and 7 catch one that assumed an even
 * split; 100 lands mid-day for the fixtures below; 5,000 is the production page size, which must
 * be in the sweep or the sweep proves nothing about production.
 */
const BATCH_SIZES = [1, 2, 3, 7, 100, DAY_FOLD_POSITION_BATCH_SIZE] as const;

/** ~1,200 fixes is one real cartrack/velocity vehicle-day at its measured 8-second cadence. */
const MORNING = '2026-08-10T04:00:00.000Z';
const FIXTURES: ReadonlyArray<readonly [string, DayPosition[]]> = [
  ['cartrack/velocity, a full day at the measured cadence', velocityRun(MORNING, 1_200, [0, 0, 42, 88, 61, 0])],
  ['cartrack/urent, 15 coarse fixes', urentDay(MORNING)],
  ['netstar/europcar, snapshot with no odometer', netstarDay(MORNING)],
  ['ituran/avis, with the 42-hour silence', ituranDayWithLongSilence(MORNING)],
  // Crossing midnight is where a batch boundary and a day boundary can interact.
  ['a run that crosses SAST midnight', velocityRun('2026-08-10T21:00:00.000Z', 1_500, [55])],
];

describe('batch-size invariance', () => {
  it('pins the production page size, which is what the sweep above has to include', () => {
    // 5,000 is four cartrack/velocity vehicle-days at 1,169 fixes/day -- large enough that an
    // ordinary rebuild is one page, small enough to stay well inside a single query's memory.
    // Lowering it toward one day's fix count is what would make a straddler bug reachable again.
    expect(DAY_FOLD_POSITION_BATCH_SIZE).toBe(5_000);
  });

  for (const [name, positions] of FIXTURES) {
    it(`is byte-identical at every batch size: ${name}`, () => {
      const reference = foldInBatches(positions, positions.length || 1).map(rowHash);
      expect(reference.length).toBeGreaterThan(0);
      for (const size of BATCH_SIZES) {
        expect(foldInBatches(positions, size).map(rowHash), `batch size ${size}`).toEqual(reference);
      }
    });
  }

  it('stays invariant when the caller supplies a lead-in and a window end', () => {
    // The window edges are the one thing in the fold that is NOT derived from the positions, so
    // they are the obvious way to reintroduce batch dependence: derive the lead-in from the first
    // batch instead of taking it from the caller, and batch size 1 sees a different lead-in from
    // batch size 5,000. Supplied once, they cannot.
    const positions = velocityRun('2026-08-10T21:00:00.000Z', 1_500, [55]);
    const window = {
      leadIn: fix('2026-08-10T20:50:00.000Z', 'cartrack', 'velocity', {
        offsetSeconds: 0, providerEventId: 'invariance-lead-in', ignition: true, speedKph: 55,
      }),
      windowEnd: '2026-08-11T06:00:00.000Z',
    };

    const foldWindowed = (batchSize: number) => {
      const fold = createDayFold(window);
      for (let i = 0; i < positions.length; i += batchSize) {
        fold.addPositions(positions.slice(i, i + batchSize));
      }
      return fold.result().map(rowHash);
    };

    const reference = foldWindowed(positions.length);
    expect(reference.length).toBeGreaterThan(0);
    for (const size of BATCH_SIZES) {
      expect(foldWindowed(size), `batch size ${size}`).toEqual(reference);
    }
  });

});

describe('result() is a read, not a write', () => {
  /** A whole SAST day at a 216 s cadence: 400 fixes, 00:00:00 through 23:56:24. */
  const DAY_START = '2026-08-09T22:00:00.000Z';
  const WINDOW_END = '2026-08-10T22:00:00.000Z';
  const wholeDay = () => velocityRun(DAY_START, 400, [45])
    .map((p, i) => ({ ...p, recordedAt: new Date(Date.parse(DAY_START) + i * 216_000).toISOString() }));

  it('called MID-STREAM does not poison the rows that come after it', () => {
    // The tail gap depends on windowEnd and on the last fix seen SO FAR. Written into the
    // accumulator, a mid-stream result() baked in a tail measured against a half-finished
    // window: the day reported 43,416 s of silence instead of 216 s and flipped
    // coverage_complete to false — and the row passed every CHECK in migration 528, so nothing
    // downstream would have caught it.
    const all = wholeDay();
    const streamed = createDayFold({ windowEnd: WINDOW_END });
    streamed.addPositions(all.slice(0, 200));
    const midStream = streamed.result();
    streamed.addPositions(all.slice(200));
    const afterMore = streamed.result();

    const oneShot = foldVehicleDays(all, [], { windowEnd: WINDOW_END });

    expect(afterMore.map(rowHash)).toEqual(oneShot.map(rowHash));
    expect(afterMore[0]!.trackerSilenceSeconds).toBe(216);
    expect(afterMore[0]!.coverageComplete).toBe(true);
    // The mid-stream row was honest about what it had seen at the time — half a day, still open.
    expect(midStream[0]!.trackerSilenceSeconds).toBeGreaterThan(216);
  });

  it('called twice with no new input returns identical rows', () => {
    const fold = createDayFold({ windowEnd: WINDOW_END });
    fold.addPositions(wholeDay());
    expect(fold.result().map(rowHash)).toEqual(fold.result().map(rowHash));
  });

  it('is idempotent even when the window edges are the only thing it would charge', () => {
    // A single fix: head and tail are the whole day between them, and both are recomputed from
    // scratch on every call rather than accumulated.
    const fold = createDayFold({ windowEnd: WINDOW_END });
    fold.addPositions([wholeDay()[100]!]);
    const first = fold.result();
    const second = fold.result();
    const third = fold.result();
    expect(second.map(rowHash)).toEqual(first.map(rowHash));
    expect(third.map(rowHash)).toEqual(first.map(rowHash));
  });
});

describe('batch-size invariance, continued', () => {
  it('is not vacuous — the hash does distinguish two different rows', () => {
    const a = foldVehicleDays(velocityRun(MORNING, 20, [40]));
    const b = foldVehicleDays(velocityRun(MORNING, 20, [41]));
    expect(rowHash(a[0]!)).not.toEqual(rowHash(b[0]!));
  });
});

describe('idempotence over an overlapping window', () => {
  /**
   * A rebuild re-reads a window that overlaps what it already folded. For any day whose fixes are
   * COMPLETE in both windows, the row must come out identical -- that is what makes re-processing
   * safe by construction rather than by careful bookkeeping.
   */
  it('produces the same row for a day that is complete in both windows', () => {
    const threeDays = [
      ...velocityRun('2026-08-09T06:00:00.000Z', 400, [0, 50, 70]),
      ...velocityRun('2026-08-10T06:00:00.000Z', 400, [0, 50, 70]),
      ...velocityRun('2026-08-11T06:00:00.000Z', 400, [0, 50, 70]),
    ];
    const middleDay = '2026-08-10';
    const wide = foldVehicleDays(threeDays);
    // A narrower window that still fully contains the middle day, opened at the previous day's
    // last fix so the interval into the middle day is present in both.
    const firstOfMiddle = threeDays.findIndex((p) => p.recordedAt >= '2026-08-10T04:00:00.000Z');
    const narrow = foldVehicleDays(threeDays.slice(firstOfMiddle - 1));

    const from = (rows: VehicleDayStats[]) => rows.find((r) => r.workDate === middleDay)!;
    expect(rowHash(from(narrow))).toEqual(rowHash(from(wide)));
  });

  it('re-folding the identical input twice yields the identical rows', () => {
    const positions = ituranDayWithLongSilence(MORNING);
    expect(foldVehicleDays(positions).map(rowHash)).toEqual(foldVehicleDays(positions).map(rowHash));
  });
});

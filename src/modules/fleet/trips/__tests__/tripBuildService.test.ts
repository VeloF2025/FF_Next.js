/**
 * The incremental build loop.
 *
 * What is tested here is not segmentation — that has its own suite — but the properties whose
 * failure is silent: a vehicle that fails must not cost the others or advance its watermark, the
 * batch loop must terminate, and a window must be REPLACED rather than added to. The last of
 * those is the one that was wrong: upserting alone cannot reap a row the rebuild no longer
 * produces, so one journey accumulated into three metric-eligible trips across successive runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listVehiclesWithPositions: vi.fn(),
  loadTripAnchorBefore: vi.fn(),
  loadPositions: vi.fn(),
  readWatermark: vi.fn(),
  writeWatermark: vi.fn(),
  replaceWindow: vi.fn(),
}));

vi.mock('../tripRepository', () => ({ ...mocks, LATE_ARRIVAL_LOOKBACK_MINUTES: 6 * 60 }));

import {
  buildTrips, buildTripsForVehicle, lookbackFloor, MAX_BATCHES_PER_VEHICLE, POSITION_BATCH_SIZE,
  resolveReadFrom,
} from '../tripBuildService';
import { DEFAULT_SEGMENT_OPTIONS, type SegmentOptions } from '../tripSegmenter';

const NOW = '2026-08-01T18:00:00.000Z';
const OPTS: SegmentOptions = { ...DEFAULT_SEGMENT_OPTIONS, now: NOW };
const VEHICLE = { vehicleId: 'v1', trackerId: 't1', provider: 'cartrack' };

function pos(time: string, ignition: boolean | null) {
  return {
    recordedAt: `2026-08-01T${time}:00.000Z`,
    ignition, lat: -26.2, lon: 28.0, speedKph: 0, odometerKm: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FLEET_TRIP_TIMEOUT_MINUTES;
  mocks.listVehiclesWithPositions.mockResolvedValue([VEHICLE]);
  mocks.loadTripAnchorBefore.mockResolvedValue(null);
  mocks.readWatermark.mockResolvedValue(null);
  mocks.writeWatermark.mockResolvedValue(undefined);
  mocks.replaceWindow.mockImplementation(async (_v, _from, trips) => ({
    deleted: 0, written: trips.length,
  }));
  mocks.loadPositions.mockResolvedValue([]);
});

afterEach(() => { delete process.env.FLEET_TRIP_TIMEOUT_MINUTES; });

describe('buildTripsForVehicle', () => {
  it('stops when a batch comes back short', async () => {
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);

    const result = await buildTripsForVehicle(VEHICLE, OPTS);

    expect(mocks.loadPositions).toHaveBeenCalledTimes(1);
    expect(result.tripsWritten).toBe(1);
    expect(result.moreRemaining).toBe(false);
  });

  it('advances the watermark to the newest position consumed', async () => {
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    expect(mocks.writeWatermark).toHaveBeenCalledWith('v1', '2026-08-01T07:00:00.000Z', 2);
  });

  it('does nothing at all when there are no positions', async () => {
    const result = await buildTripsForVehicle(VEHICLE, OPTS);
    expect(result.tripsWritten).toBe(0);
    expect(mocks.writeWatermark).not.toHaveBeenCalled();
    expect(mocks.replaceWindow).not.toHaveBeenCalled();
  });

  it('does not touch a window when there is nothing to rebuild', async () => {
    await buildTripsForVehicle(VEHICLE, OPTS);
    expect(mocks.replaceWindow).not.toHaveBeenCalled();
  });

  it('clears from readFrom, NOT from the first position returned', async () => {
    // loadPositions filters `recorded_at >= from`, so the first row can be LATER than readFrom.
    // Deleting from the first row would leave a trip anchored at readFrom undeleted — and the
    // recomputed set starts after it, so nothing replaces it either. That stale row survives every
    // rebuild: the same orphan class the window replacement exists to eliminate.
    mocks.readWatermark.mockResolvedValue('2026-08-01T12:00:00.000Z');
    // A journey began at 05:00, before the 06:00 floor — the window must open there.
    mocks.loadTripAnchorBefore.mockResolvedValue('2026-08-01T05:00:00.000Z');
    // No position at 05:00 — the earliest is 06:30.
    mocks.loadPositions.mockResolvedValueOnce([pos('06:30', true), pos('07:00', false)]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    const [, fromArg] = mocks.replaceWindow.mock.calls[0]!;
    expect(fromArg).toBe('2026-08-01T05:00:00.000Z');
    expect(fromArg).not.toBe('2026-08-01T06:30:00.000Z');
  });

  it('clears and rewrites the window ATOMICALLY, in one call', async () => {
    // Separate delete and insert statements would leave the window deleted and unwritten if the
    // insert failed -- and a PERSISTENT failure would re-clear it every tick, so the vehicle's
    // history would stay gone while reading as a legitimate "no trips".
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    expect(mocks.replaceWindow).toHaveBeenCalledTimes(1);
    const [vehicleArg, fromArg, tripsArg] = mocks.replaceWindow.mock.calls[0]!;
    expect(vehicleArg).toBe(VEHICLE);
    expect(fromArg).toBe('2026-08-01T06:00:00.000Z');
    expect(tripsArg).toHaveLength(1);
  });

  it('clears the window before writing the recomputed trips', async () => {
    mocks.readWatermark.mockResolvedValue('2026-08-01T12:00:00.000Z');
    mocks.loadTripAnchorBefore.mockResolvedValue('2026-08-01T06:00:00.000Z');
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    // The last trip's start is earlier than the lookback floor, so it wins — the window begins at
    // a trip boundary, never inside a journey.
    // The anchor is the trip containing the floor, so the window opens at a trip boundary.
    expect(mocks.replaceWindow).toHaveBeenCalledWith(
      VEHICLE, '2026-08-01T06:00:00.000Z', expect.any(Array),
    );
  });
});

describe('the stall guard', () => {
  it('stops instead of spinning when one trip fills an entire batch', async () => {
    // If a single journey is longer than one batch, the next window would start at that trip's
    // own start -- exactly where this batch began. Without the guard the loop re-reads and
    // re-replaces the same window until the batch budget is gone, doing no work and hiding it.
    mocks.readWatermark.mockResolvedValue('2026-08-01T12:00:00.000Z');
    mocks.loadTripAnchorBefore.mockResolvedValue('2026-08-01T06:00:00.000Z');

    // A full batch that is one unbroken trip beginning exactly at readFrom, and STILL OPEN —
    // `now` sits just past the last fix, so the trip has not timed out. An open trip is the only
    // one that must be re-read from its start, which is what makes this the genuine no-progress
    // case. (A closed or timed-out trip is final and the loop correctly advances past it.)
    const start = Date.parse('2026-08-01T06:00:00.000Z');
    const oneLongTrip = Array.from({ length: POSITION_BATCH_SIZE }, (_, i) => ({
      ...pos('06:00', true),
      recordedAt: new Date(start + i * 1000).toISOString(),
    }));
    mocks.loadPositions.mockResolvedValue(oneLongTrip);
    const justAfterLastFix = new Date(start + POSITION_BATCH_SIZE * 1000 + 60_000).toISOString();

    const result = await buildTripsForVehicle(VEHICLE, { ...OPTS, now: justAfterLastFix });

    // One batch, then stop — not MAX_BATCHES_PER_VEHICLE of them.
    expect(mocks.loadPositions).toHaveBeenCalledTimes(1);
    expect(result.batches).toBeLessThan(MAX_BATCHES_PER_VEHICLE);
    // And it must SAY there is more, not report a clean finish over a window it could not advance.
    expect(result.moreRemaining).toBe(true);
  });

  it('does not stall on a vehicle that drove once and has been parked since', async () => {
    // A full batch containing exactly ONE closed trip that begins at readFrom, followed by
    // thousands of parked reports — roughly a fortnight of a stationary vehicle whose tracker is
    // still reporting. When the next window started at the last trip's start regardless of its
    // state, nextFrom equalled readFrom, the stall guard fired, and the vehicle never advanced
    // again. A closed trip is final: the next window starts after the positions consumed.
    mocks.readWatermark.mockResolvedValue('2026-08-20T12:00:00.000Z');
    mocks.loadTripAnchorBefore.mockResolvedValue('2026-08-03T06:00:00.000Z');

    const oneOldTripThenParked = [
      { ...pos('06:00', true), recordedAt: '2026-08-03T06:00:00.000Z' },
      { ...pos('06:00', false), recordedAt: '2026-08-03T06:20:00.000Z' },
      ...Array.from({ length: POSITION_BATCH_SIZE - 2 }, (_, i) => ({
        ...pos('06:00', false),
        recordedAt: new Date(Date.parse('2026-08-03T07:00:00.000Z') + i * 300_000).toISOString(),
      })),
    ];
    mocks.loadPositions
      .mockResolvedValueOnce(oneOldTripThenParked)
      .mockResolvedValue([]);

    const result = await buildTripsForVehicle(VEHICLE, OPTS);

    // It must move past the parked stretch, not re-read it forever.
    expect(mocks.loadPositions).toHaveBeenCalledTimes(2);
    const secondFrom = mocks.loadPositions.mock.calls[1]![1];
    expect(secondFrom).not.toBe('2026-08-03T06:00:00.000Z');
    expect(result.moreRemaining).toBe(false);
  });

  it('re-reads a journey straddling the batch edge even though it is labelled timeout', async () => {
    // THE BACKFILL CASE, and the one no other test here builds. A journey still in progress when
    // the batch fills is closed by the segmenter as `timeout` -- not `open` -- whenever its last
    // fix is older than the staleness timeout measured against `now`. During a backfill `now` is
    // the real clock and the positions are weeks old, so EVERY straddler is labelled `timeout`.
    //
    // Advancing on the label rather than on the straddle opened the next window at the last
    // POSITION, mid-journey. One real journey was then stored as a truncated `timeout` half plus
    // a second, metric-eligible `ignition_off` trip that begins at a random point on a highway
    // and never happened. Nothing repairs it: the 6h lookback never reaches back that far.
    //
    // The property that matters is whether the trip straddles the edge, which is exactly
    // `ignitionOffAt === lastPositionAt` -- it was cut off by the batch, not by the vehicle.
    mocks.readWatermark.mockResolvedValue(null);
    mocks.loadTripAnchorBefore.mockResolvedValue(null);

    const start = Date.parse('2026-07-21T13:19:07.000Z');
    const stillDriving = Array.from({ length: POSITION_BATCH_SIZE }, (_, i) => ({
      ...pos('06:00', true),
      recordedAt: new Date(start + i * 1000).toISOString(),
    }));
    mocks.loadPositions
      .mockResolvedValueOnce(stillDriving)
      .mockResolvedValue([]);

    // `now` is a month later: a backfill over historical positions.
    const result = await buildTripsForVehicle(VEHICLE, { ...OPTS, now: '2026-08-24T10:00:00.000Z' });

    const written = mocks.replaceWindow.mock.calls[0]![2];
    expect(written[written.length - 1]!.closeReason).toBe('timeout');

    // The next window must reopen at the JOURNEY'S START so it is rebuilt whole -- never at the
    // batch's last position, which is a point in the middle of the drive.
    expect(mocks.loadPositions).toHaveBeenCalledTimes(2);
    const secondFrom = mocks.loadPositions.mock.calls[1]![1];
    expect(secondFrom).toBe('2026-07-21T13:19:07.000Z');
    expect(result.moreRemaining).toBe(false);
  });

  it('reports backlog rather than silence when the batch ceiling is reached', async () => {
    // Each batch advances, so the loop runs to the ceiling; the caller must learn there is more.
    let n = 0;
    mocks.loadPositions.mockImplementation(async () => {
      const base = Date.parse('2026-08-01T00:00:00.000Z') + (n += 1) * 3_600_000;
      return Array.from({ length: POSITION_BATCH_SIZE }, (_, i) => ({
        ...pos('06:00', true),
        ignition: i === POSITION_BATCH_SIZE - 1 ? false : true,
        recordedAt: new Date(base + i * 1000).toISOString(),
      }));
    });

    const result = await buildTripsForVehicle(VEHICLE, OPTS);

    expect(result.batches).toBe(MAX_BATCHES_PER_VEHICLE);
    expect(result.moreRemaining).toBe(true);
  });
});

describe('buildTrips', () => {
  it('lets the other vehicles through when one fails', async () => {
    mocks.listVehiclesWithPositions.mockResolvedValue([
      VEHICLE, { vehicleId: 'v2', trackerId: null, provider: 'ituran' },
    ]);
    mocks.readWatermark
      .mockRejectedValueOnce(new Error('tracker table locked'))
      .mockResolvedValue(null);
    mocks.loadPositions.mockResolvedValue([pos('06:00', true), pos('07:00', false)]);

    const result = await buildTrips(NOW);

    expect(result.status).toBe('partial');
    expect(result.vehiclesFailed).toBe(1);
    expect(result.vehiclesSucceeded).toBe(1);
    expect(result.tripsWritten).toBe(1);
  });

  it('leaves a failed vehicle’s watermark untouched so it retries the same window', async () => {
    mocks.loadPositions.mockRejectedValue(new Error('boom'));

    const result = await buildTrips(NOW);

    expect(result.status).toBe('failed');
    expect(mocks.writeWatermark).not.toHaveBeenCalled();
  });

  it('reports a clean run when every vehicle succeeds', async () => {
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);
    const result = await buildTrips(NOW);
    expect(result.status).toBe('succeeded');
    expect(result.vehiclesFailed).toBe(0);
  });

  it('honours FLEET_TRIP_TIMEOUT_MINUTES', async () => {
    process.env.FLEET_TRIP_TIMEOUT_MINUTES = '30';
    const result = await buildTrips(NOW);
    expect(result.timeoutMinutes).toBe(30);
  });

  it('falls back to the default when the override is nonsense, rather than to zero', async () => {
    // A zero or negative timeout would close every trip instantly as a timeout, silently making
    // the entire history metric-ineligible. Failing back to the default is the safe direction.
    process.env.FLEET_TRIP_TIMEOUT_MINUTES = 'soon';
    expect((await buildTrips(NOW)).timeoutMinutes).toBe(120);

    process.env.FLEET_TRIP_TIMEOUT_MINUTES = '-5';
    expect((await buildTrips(NOW)).timeoutMinutes).toBe(120);
  });

  it('reports nothing to do without inventing a failure', async () => {
    mocks.listVehiclesWithPositions.mockResolvedValue([]);
    const result = await buildTrips(NOW);
    expect(result.status).toBe('succeeded');
    expect(result.vehiclesRequested).toBe(0);
  });
});

describe('lookbackFloor', () => {
  it('is null when the vehicle has never been built', () => {
    expect(lookbackFloor(null)).toBeNull();
  });

  it('reaches back the full lookback', () => {
    expect(lookbackFloor('2026-08-01T12:00:00.000Z')).toBe('2026-08-01T06:00:00.000Z');
  });
});

describe('resolveReadFrom', () => {
  it('reads everything when there is no floor', () => {
    expect(resolveReadFrom(null, null)).toBeNull();
    expect(resolveReadFrom(null, '2026-08-01T05:00:00.000Z')).toBeNull();
  });

  it('opens at the trip that CONTAINS the floor, not at the floor', () => {
    // THE FIX. The floor at 06:00 falls inside a journey that began at 05:00. Opening there would
    // leave the 05:00 row undeleted and mint a second, nested, metric-eligible trip — measured at
    // +38% duration and distance, stable across reruns.
    expect(resolveReadFrom('2026-08-01T06:00:00.000Z', '2026-08-01T05:00:00.000Z'))
      .toBe('2026-08-01T05:00:00.000Z');
  });

  it('uses the floor when no trip begins at or before it', () => {
    // Nothing to bisect, so the floor is safe.
    expect(resolveReadFrom('2026-08-01T06:00:00.000Z', null))
      .toBe('2026-08-01T06:00:00.000Z');
  });

  it('NEVER opens a window after the trip that could contain it', () => {
    // The property, stated directly. The previous implementation took min(floor, lastTripStart),
    // which selected the bare floor whenever the vehicle had driven recently — the normal case —
    // and this assertion is what it failed.
    for (const [floor, anchor] of [
      ['2026-08-01T06:00:00.000Z', '2026-08-01T05:00:00.000Z'],
      ['2026-08-01T08:10:00.000Z', '2026-08-01T07:00:00.000Z'],
      ['2026-08-01T23:59:59.000Z', '2026-08-01T00:00:00.000Z'],
    ] as const) {
      expect(resolveReadFrom(floor, anchor)).toBe(anchor);
    }
  });
});

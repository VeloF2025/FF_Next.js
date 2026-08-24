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
  loadLastTripStart: vi.fn(),
  loadPositions: vi.fn(),
  readWatermark: vi.fn(),
  writeWatermark: vi.fn(),
  replaceWindow: vi.fn(),
}));

vi.mock('../tripRepository', () => ({ ...mocks, LATE_ARRIVAL_LOOKBACK_MINUTES: 6 * 60 }));

import { buildTrips, buildTripsForVehicle, resolveReadFrom } from '../tripBuildService';
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
  mocks.loadLastTripStart.mockResolvedValue(null);
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
    mocks.loadLastTripStart.mockResolvedValue('2026-08-01T05:00:00.000Z');
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
    mocks.loadLastTripStart.mockResolvedValue('2026-08-01T06:00:00.000Z');
    mocks.loadPositions.mockResolvedValueOnce([pos('06:00', true), pos('07:00', false)]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    // The last trip's start is earlier than the lookback floor, so it wins — the window begins at
    // a trip boundary, never inside a journey.
    // The last trip's start precedes the lookback floor, so it wins: the window opens at a trip
    // boundary, never inside a journey.
    expect(mocks.replaceWindow).toHaveBeenCalledWith(
      VEHICLE, '2026-08-01T06:00:00.000Z', expect.any(Array),
    );
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

describe('resolveReadFrom', () => {
  it('reads from the beginning when there is no watermark', () => {
    expect(resolveReadFrom(null, null)).toBeNull();
    expect(resolveReadFrom(null, '2026-08-01T06:00:00.000Z')).toBeNull();
  });

  it('uses the lookback floor when no trip has been recorded', () => {
    expect(resolveReadFrom('2026-08-01T12:00:00.000Z', null))
      .toBe('2026-08-01T06:00:00.000Z');   // 12:00 minus 6h
  });

  it('pulls back to the last trip start when it precedes the lookback floor', () => {
    // THE FIX. A bare 6h floor would begin at 06:00 — inside a journey that started at 05:00 —
    // and the rebuild would mint a second trip under a different ignition_on_at.
    expect(resolveReadFrom('2026-08-01T12:00:00.000Z', '2026-08-01T05:00:00.000Z'))
      .toBe('2026-08-01T05:00:00.000Z');
  });

  it('keeps the lookback floor when the last trip starts after it', () => {
    // No need to reconsider further back than the floor; the trip is wholly inside the window.
    expect(resolveReadFrom('2026-08-01T12:00:00.000Z', '2026-08-01T09:00:00.000Z'))
      .toBe('2026-08-01T06:00:00.000Z');
  });

  it('never begins a window after the last recorded trip started', () => {
    // The property that matters, stated directly: whatever the inputs, the window cannot open
    // inside a journey already on record.
    for (const [wm, last] of [
      ['2026-08-01T12:00:00.000Z', '2026-08-01T05:00:00.000Z'],
      ['2026-08-01T12:00:00.000Z', '2026-08-01T11:59:00.000Z'],
      ['2026-08-01T06:30:00.000Z', '2026-08-01T00:10:00.000Z'],
    ] as const) {
      const from = resolveReadFrom(wm, last)!;
      expect(from <= last).toBe(true);
    }
  });
});

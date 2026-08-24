/**
 * The incremental build loop.
 *
 * What is tested here is not segmentation — that has its own suite — but the properties whose
 * failure is silent: a vehicle that fails must not cost the others or advance its watermark, the
 * batch loop must terminate, and an open trip must survive a batch boundary rather than the
 * journey being split in two.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listVehiclesWithPositions: vi.fn(),
  loadOpenTrip: vi.fn(),
  loadPositions: vi.fn(),
  readWatermark: vi.fn(),
  writeWatermark: vi.fn(),
  upsertTrips: vi.fn(),
}));

vi.mock('../tripRepository', () => mocks);

import { buildTrips, buildTripsForVehicle, POSITION_BATCH_SIZE } from '../tripBuildService';
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
  mocks.loadOpenTrip.mockResolvedValue(null);
  mocks.readWatermark.mockResolvedValue(null);
  mocks.writeWatermark.mockResolvedValue(undefined);
  mocks.upsertTrips.mockImplementation(async (_v, trips) => trips.length);
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
    expect(mocks.upsertTrips).not.toHaveBeenCalled();
  });

  it('carries an open trip across a batch boundary instead of splitting the journey', async () => {
    // A full batch that leaves the vehicle running, then the batch that closes it.
    const full = Array.from({ length: POSITION_BATCH_SIZE }, (_, i) => ({
      ...pos('17:00', true),
      recordedAt: new Date(Date.parse('2026-08-01T17:00:00.000Z') + i * 1000).toISOString(),
    }));
    mocks.loadPositions
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ ...pos('17:00', false), recordedAt: '2026-08-01T17:55:00.000Z' }]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    // Second batch's segmentation received the open trip from the first.
    const secondWrite = mocks.upsertTrips.mock.calls[1]?.[1];
    expect(secondWrite).toHaveLength(1);
    expect(secondWrite[0].closeReason).toBe('ignition_off');
    // The journey kept its original start rather than beginning at 17:55.
    expect(secondWrite[0].ignitionOnAt).toBe('2026-08-01T17:00:00.000Z');
  });

  it('resumes from a previously persisted open trip', async () => {
    mocks.loadOpenTrip.mockResolvedValue({
      ignitionOnAt: '2026-08-01T17:40:00.000Z', ignitionOffAt: null, closeReason: 'open',
      onLat: -26.2, onLon: 28.0, offLat: null, offLon: null,
      durationSeconds: 0, movingSeconds: 0, idleSeconds: 0, distanceKm: 0,
      maxSpeedKph: null, startOdometerKm: null, endOdometerKm: null, positionCount: 1,
    });
    mocks.loadPositions.mockResolvedValueOnce([
      { ...pos('17:00', false), recordedAt: '2026-08-01T17:50:00.000Z' },
    ]);

    await buildTripsForVehicle(VEHICLE, OPTS);

    const written = mocks.upsertTrips.mock.calls[0]?.[1];
    expect(written[0].ignitionOnAt).toBe('2026-08-01T17:40:00.000Z');
    expect(written[0].closeReason).toBe('ignition_off');
  });
});

describe('buildTrips', () => {
  it('lets the other vehicles through when one fails', async () => {
    mocks.listVehiclesWithPositions.mockResolvedValue([
      VEHICLE, { vehicleId: 'v2', trackerId: null, provider: 'ituran' },
    ]);
    mocks.loadOpenTrip
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

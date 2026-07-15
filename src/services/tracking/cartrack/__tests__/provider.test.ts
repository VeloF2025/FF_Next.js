import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cartrackProvider } from '../provider';
import { log } from '@/lib/logger';

const REAL_EVENT = {
  event_id: 918273645,
  vehicle_id: 544522263,
  event_ts: '2026-07-15 10:32:59+02',
  latitude: -26.2041,
  longitude: 28.0473,
  speed: 62,
  road_speed: 60,
  road_speeding: true,
  ignition: true,
  odometer: 6787900,      // metres
  linear_g: -0.12,
  lateral_g: 0.31,
  bearing: 187,
  altitude: 1680,
  gps_fix_type: 3,
};

function providerWithEvents(events: unknown[]) {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: events, meta: { last_page: 1 } }), { status: 200 });
  return cartrackProvider({
    baseUrl: 'https://example.test/rest',
    username: 'u', password: 'p', accountRef: 'acct',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe('cartrackProvider.fetchPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalises a real event, converting odometer metres to km', async () => {
    const out = await providerWithEvents([REAL_EVENT]).fetchPositions(
      new Date('2026-07-15T08:00:00Z'), new Date('2026-07-15T09:00:00Z'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalId: '544522263',
      providerEventId: '918273645',
      lat: -26.2041,
      lon: 28.0473,
      speedKph: 62,
      roadSpeedKph: 60,
      isSpeeding: true,
      ignition: true,
      odometerKm: 6787.9,
      linearG: -0.12,
      lateralG: 0.31,
      gpsFixType: 3,
    });
    // +02 suffix must be honoured, not reinterpreted as UTC.
    expect(out[0].recordedAt.toISOString()).toBe('2026-07-15T08:32:59.000Z');
  });

  it('drops events with no GPS fix rather than emitting null coordinates', async () => {
    const noFix = { ...REAL_EVENT, latitude: null, longitude: null };
    const out = await providerWithEvents([noFix]).fetchPositions(new Date(), new Date());
    expect(out).toHaveLength(0);
  });

  it('reports absent optional telemetry as null, not zero', async () => {
    const sparse = { event_id: 1, vehicle_id: 7, event_ts: '2026-07-15 10:00:00+02',
                     latitude: -26, longitude: 28 };
    const out = await providerWithEvents([sparse]).fetchPositions(new Date(), new Date());
    expect(out[0].speedKph).toBeNull();
    expect(out[0].lateralG).toBeNull();
    expect(out[0].odometerKm).toBeNull();
  });

  it('throws when meta.last_page exceeds MAX_PAGES instead of silently truncating', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ data: [REAL_EVENT], meta: { last_page: 999 } }),
        { status: 200 }
      );
    const provider = cartrackProvider({
      baseUrl: 'https://example.test/rest',
      username: 'u', password: 'p', accountRef: 'acct',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      provider.fetchPositions(new Date('2026-07-15T08:00:00Z'), new Date('2026-07-15T09:00:00Z'))
    ).rejects.toThrow(/MAX_PAGES=20/);
  });

  it('drops an unparseable timestamp row, keeps good rows, and logs at error level with the raw value', async () => {
    const bad = { ...REAL_EVENT, event_id: 1, event_ts: 'not-a-timestamp' };
    const good = { ...REAL_EVENT, event_id: 2 };
    const out = await providerWithEvents([bad, good]).fetchPositions(new Date(), new Date());

    expect(out).toHaveLength(1);
    expect(out[0].providerEventId).toBe('2');
    expect(vi.mocked(log.error)).toHaveBeenCalledWith(
      expect.stringContaining('unparseable timestamp'),
      expect.objectContaining({ unparseableTs: 1, exampleEventTs: 'not-a-timestamp' })
    );
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });

  it('logs a null-lat/lon row at warn, not error', async () => {
    const noFix = { ...REAL_EVENT, latitude: null, longitude: null };
    await providerWithEvents([noFix]).fetchPositions(new Date(), new Date());

    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      expect.stringContaining('missing GPS fix'),
      expect.objectContaining({ noFix: 1 })
    );
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });
});

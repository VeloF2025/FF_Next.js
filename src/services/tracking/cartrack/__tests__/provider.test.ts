import { describe, it, expect } from 'vitest';
import { cartrackProvider } from '../provider';

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
});

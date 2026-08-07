/**
 * Fixture is a trimmed copy of a real ct_fleet_get_vehiclelist_v3 response
 * captured from the live urent account on 2026-08-07. Field names and values —
 * including the mangled `registration` and the metre-scale odometer — are
 * verbatim. Do not tidy them.
 */
import { describe, expect, it } from 'vitest';
import {
  newestFixAt,
  plateOf,
  readIgnition,
  toPositions,
  toVehicles,
  type FleetwebVehicle,
} from '../portalParse';

const WIDE_FROM = new Date('2026-08-01T00:00:00Z');
const WIDE_TO = new Date('2026-08-31T00:00:00Z');

const LIVE: FleetwebVehicle[] = [
  {
    vehicle_id: '164811864', vehicle_name: 'HG16TDGP', registration: 'HG16TDGP',
    latitude: '-26.385329', longitude: '27.812445', event_ts: '2026-08-07 15:55:27+02',
    speed: '12', road_speed: '60', odometer: '149989788', ignition: '2',
    bearing: '170', gps_fix_type: '3',
  },
  {
    // The trap: vehicle_name is the plate, registration carries a stray suffix.
    vehicle_id: '442570499', vehicle_name: 'HW50KNGP', registration: 'HW50KNGPNE',
    latitude: '-25.714273', longitude: '28.194376', event_ts: '2026-08-06 19:04:45+02',
    speed: '0', road_speed: '60', odometer: '140554300', ignition: '1',
    bearing: '0', gps_fix_type: '3',
  },
  {
    vehicle_id: '214889059', vehicle_name: 'JZ29GJGP', registration: 'JZ29GJGP',
    latitude: '-25.704798', longitude: '28.406153', event_ts: '2026-08-07 15:42:22+02',
    speed: '0', road_speed: '60', odometer: '104036900', ignition: '1',
    bearing: '0', gps_fix_type: '3',
  },
];

describe('plateOf', () => {
  it('uses vehicle_name, never the registration field', () => {
    // registration is 'HW50KNGPNE'; normalising that matches no fleet row, so
    // this vehicle would silently never map.
    const kn = LIVE[1]!;
    expect(plateOf(kn)).toBe('HW50KNGP');
    expect(plateOf(kn)).not.toBe(kn.registration);
  });

  it('returns null rather than an empty string when absent', () => {
    expect(plateOf({ vehicle_id: '1', vehicle_name: '  ' })).toBeNull();
    expect(plateOf({ vehicle_id: '1' })).toBeNull();
  });
});

describe('toVehicles', () => {
  it('maps the account to plates for reconciliation', () => {
    expect(toVehicles(LIVE)).toEqual([
      { externalId: '164811864', registration: 'HG16TDGP', groupName: null },
      { externalId: '442570499', registration: 'HW50KNGP', groupName: null },
      { externalId: '214889059', registration: 'JZ29GJGP', groupName: null },
    ]);
  });
});

describe('toPositions', () => {
  it('parses the +02 timestamp to the correct UTC instant', () => {
    // 15:55:27+02 is 13:55:27Z. Dropping the offset would file every fix two
    // hours late and push the watermark ahead of real data.
    const p = toPositions(LIVE, WIDE_FROM, WIDE_TO).find((x) => x.externalId === '164811864');
    expect(p?.recordedAt.toISOString()).toBe('2026-08-07T13:55:27.000Z');
  });

  it('converts the metre-scale odometer to kilometres', () => {
    // 149989788 is metres — 149 990 km. Passed through unscaled it would read
    // as 149 million km.
    const p = toPositions(LIVE, WIDE_FROM, WIDE_TO).find((x) => x.externalId === '164811864');
    expect(p?.odometerKm).toBeCloseTo(149989.788, 3);
  });

  it('carries speed, bearing, fix type and speeding verdict', () => {
    const p = toPositions(LIVE, WIDE_FROM, WIDE_TO).find((x) => x.externalId === '164811864');
    expect(p).toMatchObject({
      lat: -26.385329, lon: 27.812445,
      speedKph: 12, roadSpeedKph: 60, isSpeeding: false,
      bearing: 170, gpsFixType: 3, ignition: true, providerEventId: null,
    });
  });

  it('flags speeding only when both speed and limit are known', () => {
    const fast = toPositions(
      [{ ...LIVE[0]!, speed: '95' }], WIDE_FROM, WIDE_TO);
    expect(fast[0]?.isSpeeding).toBe(true);
    const noLimit = toPositions(
      [{ ...LIVE[0]!, road_speed: null }], WIDE_FROM, WIDE_TO);
    expect(noLimit[0]?.isSpeeding).toBeNull();
  });

  it('drops a null-island fix', () => {
    expect(toPositions(
      [{ ...LIVE[0]!, latitude: '0', longitude: '0' }], WIDE_FROM, WIDE_TO)).toHaveLength(0);
  });

  it('drops rows with an unparseable timestamp or missing coordinates', () => {
    expect(toPositions([{ ...LIVE[0]!, event_ts: null }], WIDE_FROM, WIDE_TO)).toHaveLength(0);
    expect(toPositions([{ ...LIVE[0]!, latitude: null }], WIDE_FROM, WIDE_TO)).toHaveLength(0);
  });

  it('refuses BOTH rows when two share a vehicle_id', () => {
    // A duplicated external id would attribute one vehicle's positions to
    // another, and the ingest dedup key carries no vehicle_id, so it could
    // never be repaired.
    const out = toPositions(
      [LIVE[0]!, { ...LIVE[1]!, vehicle_id: '164811864' }, LIVE[2]!],
      WIDE_FROM, WIDE_TO
    );
    expect(out.map((p) => p.externalId)).toEqual(['214889059']);
  });

  it('filters to the requested window', () => {
    // This account genuinely holds vehicles idle for days, so the window does
    // real work here rather than being a formality.
    const out = toPositions(LIVE, new Date('2026-08-07T00:00:00Z'), WIDE_TO);
    expect(out.map((p) => p.externalId).sort()).toEqual(['164811864', '214889059']);
  });

  it('survives an empty or malformed list without throwing', () => {
    expect(toPositions([], WIDE_FROM, WIDE_TO)).toEqual([]);
    expect(toPositions([null as unknown as FleetwebVehicle], WIDE_FROM, WIDE_TO)).toEqual([]);
  });
});

describe('readIgnition', () => {
  it('reads the observed two-state enum', () => {
    expect(readIgnition('2')).toBe(true);   // seen on a vehicle doing 25 km/h
    expect(readIgnition('1')).toBe(false);  // seen on four stationary vehicles
    expect(readIgnition(2)).toBe(true);
  });

  it('is null — not false — for any other value', () => {
    // The enum is undocumented and only two states were observed. Downstream
    // parking compliance treats false as definite, so an unknown must not
    // masquerade as "engine off".
    expect(readIgnition('0')).toBeNull();
    expect(readIgnition('3')).toBeNull();
    expect(readIgnition(null)).toBeNull();
    expect(readIgnition('')).toBeNull();
  });
});

describe('newestFixAt', () => {
  it('returns the freshest fix across the account', () => {
    expect(newestFixAt(LIVE)?.toISOString()).toBe('2026-08-07T13:55:27.000Z');
  });

  it('returns null when nothing has a parseable fix', () => {
    expect(newestFixAt([{ vehicle_id: '1', vehicle_name: 'X' }])).toBeNull();
    expect(newestFixAt([])).toBeNull();
  });
});

describe('newestFixAt — future-dated fixes must not defeat the dead-feed probe', () => {
  const NOW = new Date('2026-08-07T14:00:00Z');

  it('ignores a fix from a rolled-over device clock', () => {
    // The failure this guards: pollProvider computes feedAgeMs = now - newest.
    // A 2043 fix makes that NEGATIVE, so gapReason's `feedAgeMs > staleFeedMs`
    // is false forever. For a snapshot provider that is the ONLY dead-feed
    // signal, so the whole account could go dark permanently while every tick
    // logged as healthy.
    const rows: FleetwebVehicle[] = [
      { ...LIVE[0]!, vehicle_id: 'broken', event_ts: '2043-01-01 00:00:00+02' },
      { ...LIVE[1]!, vehicle_id: 'real', event_ts: '2026-08-01 09:00:00+02' },
    ];
    const newest = newestFixAt(rows, NOW);
    expect(newest?.toISOString()).toBe('2026-08-01T07:00:00.000Z');
    expect(newest!.getTime()).toBeLessThan(NOW.getTime()); // feedAgeMs stays positive
  });

  it('still accepts a fix inside the clock-skew tolerance ingest allows', () => {
    // Must match ingestPositions' own 5-minute cutoff: a fix it would store
    // has to count as fresh, or the two disagree about the same reading.
    const rows: FleetwebVehicle[] = [
      { ...LIVE[0]!, vehicle_id: 'skewed', event_ts: '2026-08-07 16:02:00+02' }, // 14:02Z, +2min
    ];
    expect(newestFixAt(rows, NOW)?.toISOString()).toBe('2026-08-07T14:02:00.000Z');
  });

  it('returns null when EVERY fix is future-dated, rather than a future date', () => {
    // null makes feedAgeMs null, which gapReason treats as "cannot tell" —
    // strictly better than a confidently wrong "fresh".
    const rows: FleetwebVehicle[] = [
      { ...LIVE[0]!, vehicle_id: 'a', event_ts: '2043-01-01 00:00:00+02' },
      { ...LIVE[1]!, vehicle_id: 'b', event_ts: '2044-01-01 00:00:00+02' },
    ];
    expect(newestFixAt(rows, NOW)).toBeNull();
  });
});

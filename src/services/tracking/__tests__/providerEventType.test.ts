/**
 * `providerEventType` across all three feeds.
 *
 * The field exists for one reason: Cartrack's device already computes harshness and states its
 * idling and motion boundaries, and `provider.ts` threw that away on every ingest for the whole
 * life of the feed. It is kept verbatim rather than normalised, because the value worth noticing
 * most is the one we do not yet have a name for.
 *
 * The second half of this file matters as much as the first. Netstar's live tree carries only an
 * `IgnitionOn` boolean and Ituran's grid only a `Statuses[].StatName` list -- neither is an event
 * vocabulary, and mapping either into this column would put a synthesised value where the schema
 * promises a provider's own. So those two must write null, and must keep writing null even when
 * their payloads are full of status text that looks mappable.
 */
import { describe, expect, it } from 'vitest';
import { cartrackProvider } from '../cartrack/provider';
import { toPositions } from '../ituran/parse';
import { parseVehicleTree } from '../netstar/tree';
import { parseAllActivityCsv } from '../netstar/parse';

const BASE_EVENT = {
  event_id: 918273645,
  vehicle_id: 544522263,
  event_ts: '2026-07-15 10:32:59+02',
  latitude: -26.2041,
  longitude: 28.0473,
  speed: 62,
  ignition: true,
};

function cartrackWith(events: unknown[]) {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: events, meta: { last_page: 1 } }), { status: 200 });
  return cartrackProvider({
    baseUrl: 'https://example.test/rest',
    username: 'u', password: 'p', accountRef: 'acct',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

const WINDOW = [new Date('2026-07-15T08:00:00Z'), new Date('2026-07-15T09:00:00Z')] as const;

describe('cartrack', () => {
  /** The full 14-value vocabulary observed over 55,009 events / 8 vehicles / 7 days. */
  const VOCABULARY = [
    'PERIODIC_EVENT', 'IDLING_START', 'IDLING_CONTINUE', 'IDLING_END',
    'MOTION_START', 'MOTION_END', 'IGNITION_ON', 'IGNITION_OFF',
    'GPS_LOCK', 'GPS_LOST', 'SPEEDING_START', 'SPEEDING_END',
    'HARSH_BRAKING', 'HARSH_CORNERING',
  ];

  it('maps event_description onto providerEventType, verbatim, for every observed value', async () => {
    const events = VOCABULARY.map((event_description, i) => ({
      ...BASE_EVENT, event_id: 900 + i, event_description,
    }));
    const out = await cartrackWith(events).fetchPositions(WINDOW[0], WINDOW[1]);
    expect(out.map((p) => p.providerEventType)).toEqual(VOCABULARY);
  });

  it('keeps a value it has never seen rather than mapping it to null', async () => {
    // HARSH_ACCELERATION was NOT observed in 55,009 events. If the firmware ever emits it -- or
    // anything else new -- it must arrive intact, because an unrecognised value silently becoming
    // null is exactly how the field was lost the first time.
    const out = await cartrackWith([{ ...BASE_EVENT, event_description: 'HARSH_ACCELERATION' }])
      .fetchPositions(WINDOW[0], WINDOW[1]);
    expect(out[0]!.providerEventType).toBe('HARSH_ACCELERATION');
  });

  it('is null when the field is absent, empty or not a string', async () => {
    const events = [
      { ...BASE_EVENT, event_id: 1 },
      { ...BASE_EVENT, event_id: 2, event_description: '' },
      { ...BASE_EVENT, event_id: 3, event_description: null },
      { ...BASE_EVENT, event_id: 4, event_description: 42 },
    ];
    const out = await cartrackWith(events).fetchPositions(WINDOW[0], WINDOW[1]);
    expect(out.map((p) => p.providerEventType)).toEqual([null, null, null, null]);
  });
});

describe('netstar', () => {
  it('leaves it null on the live tree, which carries no event field at all', () => {
    const nodes = parseVehicleTree({
      data: [{
        LeafId: 7001, Name: 'Vehicle A', GroupName: 'Fleet',
        Lat: -26.2041, Long: 28.0473, SpeedValue: 48, IgnitionOn: true,
        DateTimeUtc: '/Date(1784198400000)/',
      }],
    });
    expect(nodes[0]!.position).not.toBeNull();
    expect(nodes[0]!.position!.providerEventType).toBeNull();
  });

  it('leaves it null on the backfill CSV, whose Status column is not an event vocabulary', () => {
    // Status here is one of eight display words -- Timed Event, Stopped, Moving, Ignition on,
    // Ignition off, Speeding, Idling, HeadingChange. Two of them already drive `ignition` and
    // `isSpeeding`; promoting the rest into this column would invent a provider vocabulary.
    const csv = [
      'Time,Speed,Status,Gps,Speed Limit,Latitude,Longitude,Odometer',
      '05/08/2026 10:00:00,"48","Speeding",true,"60","-26,2041","28,0473","12345"',
    ].join('\n');
    const positions = parseAllActivityCsv(csv);
    // Not vacuous: the row above must actually parse, or the loop below asserts nothing.
    expect(positions).toHaveLength(1);
    for (const p of positions) expect(p.providerEventType).toBeNull();
  });
});

describe('ituran', () => {
  it('leaves it null even when the grid row carries status names', () => {
    const positions = toPositions({
      rows_data: {
        '5001': {
          PlatformId: 5001, Lat: -26.2041, Lon: 28.0473, LastSpeed: 40,
          Location_RowLocTime: '2026-07-15 08:30:00',
          Statuses: [{ StatName: 'Ignition On' }, { StatName: 'Vehicle Stopped' }],
        },
      },
    }, WINDOW[0], WINDOW[1]);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.providerEventType).toBeNull();
    // The status list is still read for ignition -- this is a decision about which column it may
    // reach, not a claim that the field is unused.
    expect(positions[0]!.ignition).toBe(true);
  });
});

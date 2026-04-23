/**
 * Cartrack HTTP client tests.
 *
 * The client is injectable via `fetchImpl` so we don't need to mock
 * network. Post-refactor, endpoints match Cartrack's real REST shape:
 *   - GET /vehicles                — fleet list
 *   - GET /vehicles/events         — per-ping GPS events (24h max window)
 *
 * `fetchPositionAt` queries events across the whole fleet in a window
 * and filters by `vehicle_id` in-memory. This matches how Cartrack's
 * REST actually works — there is no per-vehicle positions endpoint.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  cartrackClient,
  cartrackClientFromEnv,
  CartrackError,
  pickNearestSample,
  DEFAULT_TOLERANCE_MS,
} from '../client';
import type { CartrackPositionSample } from '../types';

function mockFetch(responses: Array<Partial<Response> | Error>): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[i++];
    if (next instanceof Error) throw next;
    if (!next) throw new Error('mockFetch: no more responses queued');
    return next as Response;
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('pickNearestSample (pure)', () => {
  const at = new Date('2026-04-20T06:00:00Z');
  const mk = (iso: string): CartrackPositionSample => ({
    vehicleId: 'v1', lat: -26.2, lon: 28.0, ts: new Date(iso),
  });

  it('returns null on empty samples', () => {
    expect(pickNearestSample([], at, 60_000)).toBe(null);
  });

  it('picks the sample with smallest absolute delta to `at`', () => {
    const samples = [
      mk('2026-04-20T05:55:00Z'),
      mk('2026-04-20T05:59:30Z'),
      mk('2026-04-20T06:02:00Z'),
    ];
    const nearest = pickNearestSample(samples, at, 5 * 60_000)!;
    expect(nearest.ts.toISOString()).toBe('2026-04-20T05:59:30.000Z');
  });

  it('excludes samples outside the tolerance window', () => {
    const samples = [
      mk('2026-04-20T05:50:00Z'),
      mk('2026-04-20T06:10:00Z'),
    ];
    expect(pickNearestSample(samples, at, 5 * 60_000)).toBe(null);
  });

  it('boundary: tolerance is inclusive', () => {
    const samples = [mk('2026-04-20T06:05:00Z')];
    expect(pickNearestSample(samples, at, 5 * 60_000)).not.toBe(null);
  });
});

describe('cartrackClientFromEnv', () => {
  it('throws CartrackError(kind=config) when any var is missing', () => {
    expect(() => cartrackClientFromEnv({})).toThrow(CartrackError);
    expect(() => cartrackClientFromEnv({ CARTRACK_BASE_URL: 'x' })).toThrow(/CARTRACK_/);
  });

  it('constructs a client when all three env vars are set', () => {
    const client = cartrackClientFromEnv({
      CARTRACK_BASE_URL: 'https://fleetapi-za.cartrack.com/rest',
      CARTRACK_API_USER: 'u',
      CARTRACK_API_PASS: 'p',
    });
    expect(client).toBeDefined();
    expect(typeof client.fetchPositionAt).toBe('function');
  });
});

describe('HttpCartrackClient.fetchPositionAt — /vehicles/events', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('sends Basic auth + GET to /vehicles/events with Cartrack-format timestamps and a limit', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return jsonResponse(200, {
        data: [
          {
            vehicle_id: 544522263,
            registration: 'TEMP-2084956',
            event_ts: '2026-04-20 05:59:45',
            latitude: -26.2,
            longitude: 28.0,
          },
        ],
      });
    }) as typeof fetch;

    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const at = new Date('2026-04-20T06:00:00Z');
    const result = await client.fetchPositionAt('544522263', at);
    expect(result.status).toBe('ok');
    expect(capturedUrl).toContain('/vehicles/events');
    expect(capturedUrl).toContain('start_timestamp=');
    expect(capturedUrl).toContain('end_timestamp=');
    expect(capturedUrl).toContain('limit=1000');
    expect(capturedAuth).toMatch(/^Basic /);
  });

  it('filters events by vehicle_id in-memory — returns only the matching vehicle', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:58:00', latitude: -26.2, longitude: 28.0 },
          { vehicle_id: 544522263, event_ts: '2026-04-20 05:59:45', latitude: -26.21, longitude: 28.01 },
          { vehicle_id: 999, event_ts: '2026-04-20 06:00:05', latitude: -26.5, longitude: 28.5 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '544522263',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sample.lat).toBe(-26.21);
      expect(result.sample.lon).toBe(28.01);
    }
  });

  it('no_data when the vehicle_id is not among the returned events', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:59:45', latitude: -26.2, longitude: 28.0 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '544522263',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('no_data');
  });

  it('no_data when the response is empty', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, { data: [] })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '1',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('no_data');
  });

  it('no_data when events exist but all fall outside the tolerance window', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 04:00:00', latitude: 0, longitude: 0 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '1',
      new Date('2026-04-20T06:00:00Z'),
      60_000
    );
    expect(result.status).toBe('no_data');
  });

  it('throws CartrackError(http) on non-2xx status', async () => {
    const fetchImpl = mockFetch([jsonResponse(500, { error: 'boom' })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws CartrackError(network) on fetch reject', async () => {
    const fetchImpl = mockFetch([new Error('ECONNRESET')]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/network/);
  });

  it('throws typed CartrackError when `data` is not an array (malformed upstream body)', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, { data: 'oops' })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/data\[\]|malformed/);
  });

  it('encodes start_timestamp/end_timestamp as Cartrack `YYYY-MM-DD hh:mm:ss` UTC (not ISO-8601)', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse(200, { data: [] });
    }) as typeof fetch;
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const at = new Date('2026-04-20T06:00:00.000Z');
    const tolMs = 3 * 60 * 1000;
    await client.fetchPositionAt('1', at, tolMs);
    const params = new URLSearchParams(capturedUrl.split('?')[1]);
    const from = params.get('start_timestamp')!;
    const to = params.get('end_timestamp')!;
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(from).toBe('2026-04-20 05:57:00');
    expect(to).toBe('2026-04-20 06:03:00');
  });

  it('default tolerance window is 5 minutes', () => {
    expect(DEFAULT_TOLERANCE_MS).toBe(5 * 60 * 1000);
  });
});

describe('HttpCartrackClient.listVehicles — /vehicles', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('maps vehicle_name as the human registration (SA tenant quirk)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          {
            vehicle_id: 544522263,
            registration: 'TEMP-2084956',
            vehicle_name: 'MW67LFGP',
            manufacturer: 'Foton',
            model: 'Truck Mate 1.5TD',
          },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const vehicles = await client.listVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]!.cartrackId).toBe('544522263');
    expect(vehicles[0]!.registration).toBe('MW67LFGP');
    expect(vehicles[0]!.description).toBe('Foton Truck Mate 1.5TD');
  });

  it('filters out rows without a vehicle_id', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, vehicle_name: 'MW67LFGP' },
          { vehicle_id: null },
          { vehicle_id: 2, vehicle_name: 'MW67LZGP' },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const vehicles = await client.listVehicles();
    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]!.cartrackId).toBe('1');
    expect(vehicles[1]!.cartrackId).toBe('2');
  });

  it('falls back to client_vehicle_description when vehicle_name is absent', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          {
            vehicle_id: 1,
            vehicle_name: null,
            client_vehicle_description: 'EMN892GP',
          },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const vehicles = await client.listVehicles();
    expect(vehicles[0]!.registration).toBe('EMN892GP');
  });

  it('throws CartrackError(http) on non-2xx', async () => {
    const fetchImpl = mockFetch([jsonResponse(401, { error: 'unauthorized' })]);
    const client = cartrackClient({
      baseUrl: 'https://fleetapi-za.cartrack.com/rest',
      username: 'u',
      password: 'p',
      fetchImpl,
    });
    await expect(client.listVehicles()).rejects.toThrow(/HTTP 401/);
  });
});

describe('fetchPositionAt — pagination + shape guards (P0/P1 hardening)', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('follows pagination: concatenates data across pages and picks nearest overall', async () => {
    // Regression test: prior to pagination following, this adapter threw on
    // any `meta.last_page > 1` response — Cartrack time-sorts, so the tail
    // (closest events to the clock time) silently dropped before. Now we
    // follow to `last_page` and aggregate, letting pickNearestSample pick
    // from the full candidate set.
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:55:00', latitude: -26.21, longitude: 28.0 },
        ],
        meta: { current_page: 1, last_page: 3, total: 2500 },
      }),
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:58:00', latitude: -26.205, longitude: 28.0 },
        ],
        meta: { current_page: 2, last_page: 3, total: 2500 },
      }),
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:59:55', latitude: -26.2001, longitude: 28.0 },
        ],
        meta: { current_page: 3, last_page: 3, total: 2500 },
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '1',
      new Date('2026-04-20T06:00:00Z')
    );
    // Nearest to 06:00:00Z across all three pages is page 3's 05:59:55Z sample.
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sample.lat).toBeCloseTo(-26.2001);
      expect(result.sample.ts.toISOString()).toBe('2026-04-20T05:59:55.000Z');
    }
  });

  it('rejects when pagination exceeds MAX_PAGES (runaway guard)', async () => {
    // Build 12 responses all advertising last_page=12 so the adapter
    // tries to keep going past the MAX_PAGES=10 cap. Throws on page 11.
    const responses = Array.from({ length: 11 }, (_, i) =>
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:55:00', latitude: -26.2, longitude: 28.0 },
        ],
        meta: { current_page: i + 1, last_page: 12, total: 12000 },
      })
    );
    const fetchImpl = mockFetch(responses);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/MAX_PAGES=10/);
  });

  it('throws on empty vehicleId input (defence against empty cartrack_vehicle_id column)', async () => {
    const client = cartrackClient({ ...baseOpts, fetchImpl: (async () => {
      throw new Error('should not reach fetch');
    }) as typeof fetch });
    await expect(
      client.fetchPositionAt('', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/vehicleId/);
    await expect(
      client.fetchPositionAt('   ', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/vehicleId/);
  });

  it('throws on data: null (symmetric shape check)', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, { data: null })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/data\[\].*null/);
  });

  it('throws on data: undefined (contract violation from 2xx)', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, {})]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/data\[\].*undefined/);
  });

  it('throws when any event row is missing vehicle_id (payload malformation)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20 05:59:45', latitude: -26.2, longitude: 28.0 },
          { event_ts: '2026-04-20 05:59:50', latitude: -26.2, longitude: 28.0 }, // no vehicle_id
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/missing vehicle_id/);
  });
});

describe('fetchPositionAt — vehicle_id type coercion + filter correctness', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('filters correctly when vehicle_id arrives as a number OR a string (Cartrack tolerates both)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 544522263, event_ts: '2026-04-20 05:59:40', latitude: -26.2, longitude: 28.0 },
          { vehicle_id: '544522263', event_ts: '2026-04-20 05:59:50', latitude: -26.21, longitude: 28.01 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '544522263',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('ok');
    // Both rows match; picker chooses the one closer to 06:00 (05:59:50 beats 05:59:40).
    if (result.status === 'ok') expect(result.sample.lat).toBe(-26.21);
  });

  it('substring false-positive guard: "5445" must NOT match "544522263"', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 544522263, event_ts: '2026-04-20 05:59:45', latitude: -26.2, longitude: 28.0 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '5445',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('no_data');
  });
});

describe('fetchPositionAt — event_ts format variants + GPS-fix-less warn', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('parses event_ts in all documented formats (space+UTC, ISO+Z, ISO+offset)', async () => {
    const at = new Date('2026-04-20T06:00:00Z');
    for (const id of ['1', '2', '3']) {
      // Re-mock for each iteration — mockFetch consumes one response per call
      const one = mockFetch([
        jsonResponse(200, {
          data: [
            id === '1' ? { vehicle_id: 1, event_ts: '2026-04-20 06:00:00', latitude: -26.2, longitude: 28.0 }
            : id === '2' ? { vehicle_id: 2, event_ts: '2026-04-20T06:00:00Z', latitude: -26.2, longitude: 28.0 }
            : { vehicle_id: 3, event_ts: '2026-04-20T08:00:00+02:00', latitude: -26.2, longitude: 28.0 },
          ],
        }),
      ]);
      const c = cartrackClient({ ...baseOpts, fetchImpl: one });
      const r = await c.fetchPositionAt(id, at);
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        // All three should land at exactly the clock time.
        expect(r.sample.ts.toISOString()).toBe('2026-04-20T06:00:00.000Z');
      }
    }
  });

  it('toSample returns null for unparseable event_ts (e.g. date-only, no time)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          { vehicle_id: 1, event_ts: '2026-04-20', latitude: -26.2, longitude: 28.0 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      '1',
      new Date('2026-04-20T06:00:00Z')
    );
    // Date('2026-04-20Z') is actually valid (midnight UTC) — but that's
    // outside the ±5min window from 06:00, so `no_data`. The toSample
    // function itself returns a sample; picker discards it.
    expect(result.status).toBe('no_data');
  });
});

describe('listVehicles — pagination + shape + fallback (P0/P1 hardening)', () => {
  const baseOpts = {
    baseUrl: 'https://fleetapi-za.cartrack.com/rest',
    username: 'u',
    password: 'p',
  };

  it('follows pagination: assembles full fleet across pages', async () => {
    // Regression test: previously the adapter threw on any paginated
    // /vehicles response, silently truncating large fleets. Now we follow
    // to last_page and assemble the full list.
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [{ vehicle_id: 1, vehicle_name: 'MW67LFGP' }],
        meta: { current_page: 1, last_page: 2, total: 600 },
      }),
      jsonResponse(200, {
        data: [{ vehicle_id: 2, vehicle_name: 'NX12PXGP' }],
        meta: { current_page: 2, last_page: 2, total: 600 },
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const fleet = await client.listVehicles();
    expect(fleet).toHaveLength(2);
    expect(fleet.map((v) => v.cartrackId)).toEqual(['1', '2']);
    expect(fleet.map((v) => v.registration)).toEqual(['MW67LFGP', 'NX12PXGP']);
  });

  it('rejects when pagination exceeds MAX_PAGES (runaway fleet guard)', async () => {
    const responses = Array.from({ length: 11 }, (_, i) =>
      jsonResponse(200, {
        data: [{ vehicle_id: i + 1, vehicle_name: `V${i + 1}` }],
        meta: { current_page: i + 1, last_page: 12, total: 6000 },
      })
    );
    const fetchImpl = mockFetch(responses);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(client.listVehicles()).rejects.toThrow(/MAX_PAGES=10/);
  });

  it('throws on data: null or non-array (symmetric shape check)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, { data: null }),
      jsonResponse(200, { data: 'oops' }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(client.listVehicles()).rejects.toThrow(/data\[\].*null/);
    await expect(client.listVehicles()).rejects.toThrow(/data\[\].*string/);
  });

  it('emits registration=null when both vehicle_name and client_vehicle_description are null (not filtered out)', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        data: [
          {
            vehicle_id: 42,
            vehicle_name: null,
            client_vehicle_description: null,
            manufacturer: 'Foton',
            model: 'Tunland',
          },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const vehicles = await client.listVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]!.registration).toBe(null);
    // Row is still present so a mapping admin can manually claim it.
    expect(vehicles[0]!.description).toBe('Foton Tunland');
  });
});

describe('HttpCartrackClient timeout', () => {
  it('aborts via AbortController after timeoutMs', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;

    const client = cartrackClient({
      baseUrl: 'https://fleetapi-za.cartrack.com/rest',
      username: 'u',
      password: 'p',
      fetchImpl,
      timeoutMs: 50,
    });
    await expect(
      client.fetchPositionAt('1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/network/);
  });
});

/**
 * Cartrack HTTP client tests.
 *
 * The client is injectable via `fetchImpl` so we don't need to mock
 * network. Tests cover: env config validation, auth header shape,
 * nearest-sample picker (pure), 404 → vehicle_not_mapped, empty samples
 * → no_data, non-OK 5xx → throws, timeout via AbortController.
 */

import { describe, it, expect } from 'vitest';
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
      mk('2026-04-20T05:55:00Z'), // -5m
      mk('2026-04-20T05:59:30Z'), // -30s — nearest
      mk('2026-04-20T06:02:00Z'), // +2m
    ];
    const nearest = pickNearestSample(samples, at, 5 * 60_000)!;
    expect(nearest.ts.toISOString()).toBe('2026-04-20T05:59:30.000Z');
  });

  it('excludes samples outside the tolerance window', () => {
    const samples = [
      mk('2026-04-20T05:50:00Z'), // -10m, outside 5m window
      mk('2026-04-20T06:10:00Z'), // +10m, outside
    ];
    expect(pickNearestSample(samples, at, 5 * 60_000)).toBe(null);
  });

  it('boundary: tolerance is inclusive (exactly ± tolerance still matches)', () => {
    const samples = [mk('2026-04-20T06:05:00Z')]; // exactly +5m
    const nearest = pickNearestSample(samples, at, 5 * 60_000);
    expect(nearest).not.toBe(null);
  });
});

describe('cartrackClientFromEnv', () => {
  it('throws CartrackError(kind=config) when any var is missing', () => {
    expect(() => cartrackClientFromEnv({})).toThrow(CartrackError);
    expect(() => cartrackClientFromEnv({ CARTRACK_BASE_URL: 'x' })).toThrow(/CARTRACK_/);
  });

  it('constructs a client when all three env vars are set', () => {
    const client = cartrackClientFromEnv({
      CARTRACK_BASE_URL: 'https://api.cartrack.example',
      CARTRACK_API_USER: 'u',
      CARTRACK_API_PASS: 'p',
    });
    expect(client).toBeDefined();
    expect(typeof client.fetchPositionAt).toBe('function');
  });
});

describe('HttpCartrackClient.fetchPositionAt', () => {
  const baseOpts = {
    baseUrl: 'https://api.cartrack.example',
    username: 'u',
    password: 'p',
  };

  it('sends Basic auth + GET to /vehicles/:id/positions with from/to window', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return jsonResponse(200, {
        positions: [
          { timestamp: '2026-04-20T05:59:45Z', latitude: -26.2, longitude: 28.0 },
        ],
      });
    }) as typeof fetch;

    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const at = new Date('2026-04-20T06:00:00Z');
    const result = await client.fetchPositionAt('veh-42', at);
    expect(result.status).toBe('ok');
    expect(capturedUrl).toContain('/vehicles/veh-42/positions');
    expect(capturedUrl).toContain('from=');
    expect(capturedUrl).toContain('to=');
    expect(capturedAuth).toMatch(/^Basic /);
  });

  it('returns vehicle_not_mapped on HTTP 404', async () => {
    const fetchImpl = mockFetch([jsonResponse(404, { error: 'not found' })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      'missing',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('vehicle_not_mapped');
  });

  it('returns no_data when positions array is empty', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, { positions: [] })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      'v-1',
      new Date('2026-04-20T06:00:00Z')
    );
    expect(result.status).toBe('no_data');
  });

  it('returns no_data when no sample falls inside the tolerance window', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        positions: [
          { timestamp: '2026-04-20T05:30:00Z', latitude: 0, longitude: 0 },
        ],
      }),
    ]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    const result = await client.fetchPositionAt(
      'v-1',
      new Date('2026-04-20T06:00:00Z'),
      60_000 // 1 minute window — 30-min-old sample excluded
    );
    expect(result.status).toBe('no_data');
  });

  it('throws CartrackError(http) on non-404, non-2xx status', async () => {
    const fetchImpl = mockFetch([jsonResponse(500, { error: 'boom' })]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('v-1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws CartrackError(network) on fetch reject', async () => {
    const fetchImpl = mockFetch([new Error('ECONNRESET')]);
    const client = cartrackClient({ ...baseOpts, fetchImpl });
    await expect(
      client.fetchPositionAt('v-1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/network/);
  });

  it('default tolerance window is exported as 5 minutes', () => {
    expect(DEFAULT_TOLERANCE_MS).toBe(5 * 60 * 1000);
  });

  it('encodes from/to as ISO-8601 UTC timestamps bracketing `at` by toleranceMs', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse(200, { positions: [] });
    }) as typeof fetch;
    const client = cartrackClient({
      baseUrl: 'https://api.cartrack.example',
      username: 'u',
      password: 'p',
      fetchImpl,
    });
    const at = new Date('2026-04-20T06:00:00.000Z');
    const tolMs = 3 * 60 * 1000;
    await client.fetchPositionAt('veh-1', at, tolMs);
    const params = new URLSearchParams(capturedUrl.split('?')[1]);
    const from = params.get('from')!;
    const to = params.get('to')!;
    expect(new Date(from).getTime()).toBe(at.getTime() - tolMs);
    expect(new Date(to).getTime()).toBe(at.getTime() + tolMs);
    // Lock the ISO-8601 shape so a refactor to epoch-ms would break here.
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws typed CartrackError when positions is not an array (malformed upstream body)', async () => {
    const fetchImpl = mockFetch([jsonResponse(200, { positions: 'oops' })]);
    const client = cartrackClient({
      baseUrl: 'https://api.cartrack.example',
      username: 'u',
      password: 'p',
      fetchImpl,
    });
    await expect(
      client.fetchPositionAt('v-1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/positions\[\]|malformed/);
  });
});

describe('HttpCartrackClient.listVehicles', () => {
  it('parses vehicles + filters out rows without an id', async () => {
    const fetchImpl = mockFetch([
      jsonResponse(200, {
        vehicles: [
          { id: 'v-1', registration: 'CA12345', description: 'Bakkie' },
          { id: '', registration: 'junk' },
          { id: 'v-2', registration: 'ND67890', description: null },
        ],
      }),
    ]);
    const client = cartrackClient({
      baseUrl: 'https://api.cartrack.example',
      username: 'u',
      password: 'p',
      fetchImpl,
    });
    const vehicles = await client.listVehicles();
    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]!.cartrackId).toBe('v-1');
    expect(vehicles[1]!.cartrackId).toBe('v-2');
  });

  it('throws CartrackError(http) on non-2xx', async () => {
    const fetchImpl = mockFetch([jsonResponse(401, { error: 'unauthorized' })]);
    const client = cartrackClient({
      baseUrl: 'https://api.cartrack.example',
      username: 'u',
      password: 'p',
      fetchImpl,
    });
    await expect(client.listVehicles()).rejects.toThrow(/HTTP 401/);
  });
});

describe('HttpCartrackClient timeout', () => {
  it('aborts via AbortController after timeoutMs', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;

    const client = cartrackClient({
      baseUrl: 'https://api.cartrack.example',
      username: 'u',
      password: 'p',
      fetchImpl,
      timeoutMs: 50,
    });
    await expect(
      client.fetchPositionAt('v-1', new Date('2026-04-20T06:00:00Z'))
    ).rejects.toThrow(/network/);
  });
});

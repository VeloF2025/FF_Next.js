import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, cartrackProviderMock, ingestPositionsMock, logMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  cartrackProviderMock: vi.fn(),
  ingestPositionsMock: vi.fn(),
  logMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));
vi.mock('@/lib/logger', () => ({ log: logMock }));
vi.mock('@/services/tracking/cartrack/provider', () => ({
  cartrackProvider: (...a: unknown[]) => cartrackProviderMock(...a),
}));
vi.mock('@/services/tracking/ingest', () => ({
  ingestPositions: (...a: unknown[]) => ingestPositionsMock(...a),
}));

import handler from '../poll-tracking';

const SECRET = 'test-cron-secret';
const AUTH = { 'x-cron-secret': SECRET };

/** Default sql() stub: lock acquires, no existing watermark, upserts no-op. */
function stubSql({
  lockAcquired = true,
  watermarkRow = null as { last_event_ts: string | null } | null,
} = {}) {
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('');
    if (text.includes('pg_try_advisory_lock')) return [{ locked: lockAcquired }];
    if (text.includes('SELECT last_event_ts')) return watermarkRow ? [watermarkRow] : [];
    return [];
  });
}

function makeFakeProvider(overrides: Partial<{
  key: string;
  accountRef: string;
  fetchPositions: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    key: overrides.key ?? 'cartrack',
    accountRef: overrides.accountRef ?? 'default',
    listVehicles: vi.fn().mockResolvedValue([]),
    fetchPositions: overrides.fetchPositions ?? vi.fn().mockResolvedValue([]),
  };
}

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'GET') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

describe('GET/POST /api/cron/poll-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.CARTRACK_BASE_URL = 'https://fleetapi.cartrack.com';
    process.env.CARTRACK_API_USER = 'user';
    process.env.CARTRACK_API_PASS = 'pass';
    process.env.CARTRACK_ACCOUNT_REF = 'velocity';
    stubSql();
    cartrackProviderMock.mockReturnValue(makeFakeProvider());
    ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0 });
  });

  it('rejects non-GET/POST methods with 405', async () => {
    const res = await run(AUTH, 'PUT');
    expect(res._getStatusCode()).toBe(405);
  });

  it('fails closed (not open) when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(503);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the cron secret header is missing', async () => {
    const res = await run({});
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when the cron secret header is wrong', async () => {
    const res = await run({ 'x-cron-secret': 'nope' });
    expect(res._getStatusCode()).toBe(401);
  });

  it('skips the tick without polling when the advisory lock is already held', async () => {
    stubSql({ lockAcquired: false });
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: 'already-running' });
    expect(cartrackProviderMock().fetchPositions).not.toHaveBeenCalled();
  });

  it('always releases the advisory lock, even when a provider throws', async () => {
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockRejectedValue(new Error('boom')) })
    );
    await run(AUTH);
    const unlockCall = sqlMock.mock.calls.find((c) => (c[0] as TemplateStringsArray).join('').includes('pg_advisory_unlock'));
    expect(unlockCall).toBeDefined();
  });

  it('cold start with no watermark backfills from 6 hours ago', async () => {
    const fetchPositions = vi.fn().mockResolvedValue([]);
    cartrackProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
    const before = Date.now();
    await run(AUTH);
    const [from, to] = fetchPositions.mock.calls[0] as [Date, Date];
    expect(to.getTime()).toBeGreaterThanOrEqual(before);
    expect(to.getTime() - from.getTime()).toBeCloseTo(6 * 60 * 60 * 1000, -3);
  });

  it('warm start re-polls from the watermark minus a 2-minute overlap', async () => {
    const lastEventTs = '2026-07-15T07:00:00.000Z';
    stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
    const fetchPositions = vi.fn().mockResolvedValue([]);
    cartrackProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
    await run(AUTH);
    const [from] = fetchPositions.mock.calls[0] as [Date, Date];
    expect(from.getTime()).toBe(new Date(lastEventTs).getTime() - 2 * 60 * 1000);
  });

  it('threads provider.key AND provider.accountRef through to ingestPositions — not external_id-only lookup', async () => {
    // This is the crux of the required deviation from the brief: dropping
    // accountRef here is exactly the bug that would let Urent's positions
    // land on Velocity's vehicles (or vice versa) if their external_ids
    // ever collide.
    const fakePositions = [{ externalId: 'v1' }];
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ accountRef: 'urent', fetchPositions: vi.fn().mockResolvedValue(fakePositions) })
    );
    await run(AUTH);
    expect(ingestPositionsMock).toHaveBeenCalledWith('cartrack', 'urent', fakePositions);
  });

  it('reports inserted/skippedUnmapped per provider on success', async () => {
    ingestPositionsMock.mockResolvedValue({ inserted: 5, skippedUnmapped: 2 });
    const res = await run(AUTH);
    expect(res._getJSONData().data.results).toEqual([
      expect.objectContaining({ provider: 'cartrack', accountRef: 'default', inserted: 5, skippedUnmapped: 2 }),
    ]);
  });

  it('does not advance the watermark when a provider fails, and the failure does not blow up the tick', async () => {
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockRejectedValue(new Error('network down')) })
    );
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    const watermarkUpsert = sqlMock.mock.calls.find((c) =>
      (c[0] as TemplateStringsArray).join('').includes('INSERT INTO fleet_tracking_watermarks') &&
      (c[0] as TemplateStringsArray).join('').includes('last_error')
    );
    expect(watermarkUpsert).toBeDefined();
    // The failure-path upsert must not touch last_event_ts at all — only
    // the success-path upsert (never reached here) may advance it.
    expect((watermarkUpsert![0] as TemplateStringsArray).join('')).not.toContain('last_event_ts');
    expect(res._getJSONData().data.results[0]).toMatchObject({ provider: 'cartrack', error: 'network down' });
  });

  it('distinguishes a 401 (credentials/entitlement, will not self-heal) from a generic failure', async () => {
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockRejectedValue(new Error('Cartrack HTTP 401 for https://x')) })
    );
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).toMatchObject({ authFailure: true });
    expect(logMock.error).toHaveBeenCalledWith(
      expect.stringContaining('auth failure'),
      expect.objectContaining({ provider: 'cartrack' })
    );
  });

  it('does not mark a generic 500 as an auth failure', async () => {
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockRejectedValue(new Error('Cartrack HTTP 500 for https://x')) })
    );
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).toMatchObject({ authFailure: false });
  });

  it('returns an empty results array when no provider is configured', async () => {
    delete process.env.CARTRACK_BASE_URL;
    const res = await run(AUTH);
    expect(res._getJSONData().data.results).toEqual([]);
  });
});

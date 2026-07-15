import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, poolConnectMock, cartrackProviderMock, ingestPositionsMock, logMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  poolConnectMock: vi.fn(),
  cartrackProviderMock: vi.fn(),
  ingestPositionsMock: vi.fn(),
  logMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  pool: { connect: (...a: unknown[]) => poolConnectMock(...a) },
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

/**
 * The advisory lock is now acquired/released on a single pinned client
 * (pool.connect()), not via sql``/pool.query() — that's the whole point of
 * the Critical-1 fix, since pg_try_advisory_lock/pg_advisory_unlock are
 * session-scoped. This fake client stands in for that pinned connection.
 */
function makeFakeClient({ lockAcquired = true } = {}) {
  const query = vi.fn(async (text: string) => {
    if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: lockAcquired }] };
    if (text.includes('pg_advisory_unlock')) return { rows: [{}] };
    return { rows: [] };
  });
  const release = vi.fn();
  return { query, release };
}

/**
 * Default sql() stub: no existing watermark, upserts no-op, and one active
 * tracker so the window-budget clamp has a fleet size to work from.
 */
function stubSql({
  watermarkRow = null as { last_event_ts: string | null } | null,
  activeTrackers = 1,
} = {}) {
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('');
    if (text.includes('SELECT last_event_ts')) return watermarkRow ? [watermarkRow] : [];
    if (text.includes('FROM fleet_vehicle_trackers')) return [{ n: activeTrackers }];
    return [];
  });
}

function makeFakeProvider(overrides: Partial<{
  key: string;
  accountRef: string;
  maxEventsPerFetch: number;
  fetchPositions: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    key: overrides.key ?? 'cartrack',
    accountRef: overrides.accountRef ?? 'default',
    // Cartrack's real budget: MAX_PAGES(20) * PAGE_SIZE(1000).
    maxEventsPerFetch: overrides.maxEventsPerFetch ?? 20_000,
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
    poolConnectMock.mockImplementation(async () => makeFakeClient());
    cartrackProviderMock.mockReturnValue(makeFakeProvider());
    ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0, maxIngestedAt: null });
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
    const client = makeFakeClient({ lockAcquired: false });
    poolConnectMock.mockImplementation(async () => client);
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ skipped: 'already-running' });
    expect(cartrackProviderMock().fetchPositions).not.toHaveBeenCalled();
    // Never held the lock, so must never attempt to unlock it — but the
    // pinned connection itself must still be released back to the pool.
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), expect.anything());
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('acquires and releases the advisory lock on the SAME pinned connection — not sql``/pool.query()', async () => {
    // The whole point of the Critical-1 fix: pg_try_advisory_lock and
    // pg_advisory_unlock are session-scoped. If either call went through
    // sql`` (an arbitrary connection from the pool) instead of the pinned
    // client, this would either not compile against this test's mocks or
    // the lock/unlock pair would silently run on different sessions.
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    await run(AUTH);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [4417301]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), [4417301]);
    expect(sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join('').includes('advisory'))).toBe(false);
  });

  it('always releases the pinned connection back to the pool, even when a provider throws', async () => {
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    cartrackProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockRejectedValue(new Error('boom')) })
    );
    await run(AUTH);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), expect.anything());
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the unlock query itself fails — logs instead, and still releases the connection', async () => {
    const client = makeFakeClient();
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('pg_advisory_unlock')) throw new Error('connection reset');
      return { rows: [] };
    });
    poolConnectMock.mockImplementation(async () => client);
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200); // response already sent; unlock failure must not surface as a crash
    expect(logMock.error).toHaveBeenCalledWith(
      expect.stringContaining('advisory unlock failed'),
      expect.objectContaining({ error: expect.stringContaining('connection reset') })
    );
    // ...and destroys the connection rather than handing it back. The lock is
    // session-scoped, so this connection still holds it; the pool keeps min: 1
    // and would never evict it, stranding the lock for the life of the process.
    // Every later tick would then skip with a 200 — tracking dead, looking fine.
    // Ending the session is what makes Postgres drop the lock.
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('returns the connection to the pool (does NOT destroy it) when the unlock succeeds', async () => {
    // The counterpart to the test above: destroying on every tick would churn
    // a fresh connection every 2 minutes for no reason.
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    await run(AUTH);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalledWith(true);
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

  it('warm start re-polls from the watermark minus a 30-minute overlap', async () => {
    // The overlap is what catches a vehicle that buffered fixes while out of
    // GSM coverage: its events arrive late stamped with an old event_ts, and
    // the watermark has already moved on past them. Anything older than this
    // window when it lands is never fetched again, so shrinking this value
    // silently drops those fixes — pin it.
    //
    // Pin the clock too: `from` is now also floored by the window-budget
    // clamp, which is measured back from now(). Against the real wall clock a
    // hard-coded watermark drifts ever further into the past until the clamp
    // — correctly — takes over, and this test would fail for a reason that has
    // nothing to do with the overlap it exists to check.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-15T07:05:00.000Z'));
      const lastEventTs = '2026-07-15T07:00:00.000Z';
      stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
      const fetchPositions = vi.fn().mockResolvedValue([]);
      cartrackProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
      await run(AUTH);
      const [from] = fetchPositions.mock.calls[0] as [Date, Date];
      expect(from.getTime()).toBe(new Date(lastEventTs).getTime() - 30 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps the window to the event budget when the fleet makes it unaffordable', async () => {
    // The regression: a 6h cold start costs ~26k events at 22 vehicles against
    // a 20k budget, so fetchPositions throws. A throw leaves the watermark
    // unset, so the next tick cold-starts and throws again — the poller never
    // starts. Verified against the live account 2026-07-15 (~200 ev/h/vehicle).
    vi.useFakeTimers();
    try {
      const now = new Date('2026-07-15T12:00:00.000Z');
      vi.setSystemTime(now);
      stubSql({ watermarkRow: null, activeTrackers: 22 }); // cold start, big fleet
      const fetchPositions = vi.fn().mockResolvedValue([]);
      cartrackProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
      await run(AUTH);

      const [from] = fetchPositions.mock.calls[0] as [Date, Date];
      const windowHours = (now.getTime() - from.getTime()) / 3_600_000;
      expect(windowHours).toBeLessThan(6); // clamped below COLD_START_MS
      // and the request it produces must fit the budget at 200 ev/h/vehicle
      expect(windowHours * 200 * 22).toBeLessThanOrEqual(20_000);

      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('window clamped'),
        expect.objectContaining({ activeTrackers: 22 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clamp — or warn — when the fleet is small enough to afford the cold start', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-07-15T12:00:00.000Z');
      vi.setSystemTime(now);
      stubSql({ watermarkRow: null, activeTrackers: 7 }); // today's tracked fleet
      const fetchPositions = vi.fn().mockResolvedValue([]);
      cartrackProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
      await run(AUTH);

      const [from] = fetchPositions.mock.calls[0] as [Date, Date];
      expect(now.getTime() - from.getTime()).toBe(6 * 60 * 60 * 1000); // full cold start
      expect(logMock.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('window clamped'),
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
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
    ingestPositionsMock.mockResolvedValue({ inserted: 5, skippedUnmapped: 2, maxIngestedAt: null });
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

  describe('watermark write: pins the value written to last_event_ts', () => {
    // ingestPositions is mocked here (unit-isolated) — its own maxIngestedAt
    // computation, including the future-date and all-unmapped guards, is
    // covered against real ProviderPosition data in ingest.test.ts and in
    // poll-tracking.watermark.test.ts. These tests pin the trivial-looking
    // but previously-untested wiring in poll-tracking.ts itself: whatever
    // ingestPositions.maxIngestedAt comes back as is exactly what gets
    // written, falling back to the prior watermark on null.
    function successUpsertValue(): unknown {
      const call = sqlMock.mock.calls.find((c) => {
        const text = (c[0] as TemplateStringsArray).join('');
        return text.includes('INSERT INTO fleet_tracking_watermarks') && text.includes('last_event_ts');
      });
      if (!call) throw new Error('no success-path watermark upsert found');
      return call[3]; // ${provider.key}, ${accountRef}, ${last_event_ts value} — 3rd interpolated value
    }

    it('advances last_event_ts to the max ingested timestamp on a normal batch', async () => {
      const maxIngestedAt = new Date('2026-07-15T08:05:00.000Z');
      ingestPositionsMock.mockResolvedValue({ inserted: 2, skippedUnmapped: 0, maxIngestedAt });
      await run(AUTH);
      expect(successUpsertValue()).toEqual(maxIngestedAt);
    });

    it('holds the existing watermark on an empty batch (maxIngestedAt null)', async () => {
      const lastEventTs = '2026-07-15T07:00:00.000Z';
      stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
      ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0, maxIngestedAt: null });
      await run(AUTH);
      expect(successUpsertValue()).toEqual(new Date(lastEventTs));
    });

    it('holds the existing watermark on an all-unmapped batch (maxIngestedAt null despite fetched positions)', async () => {
      const lastEventTs = '2026-07-15T07:00:00.000Z';
      stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
      cartrackProviderMock.mockReturnValue(
        makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([{ externalId: 'unmapped-1' }]) })
      );
      ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 1, maxIngestedAt: null });
      await run(AUTH);
      expect(successUpsertValue()).toEqual(new Date(lastEventTs));
    });

    it('stays null on a cold-start all-unmapped batch — does not fabricate a watermark', async () => {
      // No prior watermark row at all (cold start) AND nothing ingested:
      // last is null, maxIngestedAt is null, so the written value must be
      // null too — never a stray Date — or the next tick's cold-start
      // backfill window is lost.
      ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 1, maxIngestedAt: null });
      await run(AUTH);
      expect(successUpsertValue()).toBeNull();
    });
  });
});

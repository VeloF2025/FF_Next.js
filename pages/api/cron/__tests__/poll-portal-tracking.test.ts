import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const {
  sqlMock, poolConnectMock, netstarClientMock, netstarProviderMock,
  reconcileTrackersMock, ingestPositionsMock, raiseTrackingAlertMock,
  alertRecipientCountMock, logMock,
} = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  poolConnectMock: vi.fn(),
  netstarClientMock: vi.fn(),
  netstarProviderMock: vi.fn(),
  reconcileTrackersMock: vi.fn(),
  ingestPositionsMock: vi.fn(),
  raiseTrackingAlertMock: vi.fn(),
  alertRecipientCountMock: vi.fn(() => 1),
  logMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  pool: { connect: (...a: unknown[]) => poolConnectMock(...a) },
}));
vi.mock('@/lib/logger', () => ({ log: logMock }));
// importActual so PartialFetchError stays the real class — `instanceof` in
// pollProvider is what separates "some vehicles failed" from "the portal died",
// and a stubbed class would make that check silently false.
vi.mock('@/services/tracking/netstar/client', async () => {
  const actual = await vi.importActual<typeof import('@/services/tracking/netstar/client')>(
    '@/services/tracking/netstar/client'
  );
  return { ...actual, netstarClient: (...a: unknown[]) => netstarClientMock(...a) };
});
vi.mock('@/services/tracking/netstar/provider', () => ({
  netstarProvider: (...a: unknown[]) => netstarProviderMock(...a),
}));
vi.mock('@/services/tracking/discovery', () => ({
  reconcileTrackers: (...a: unknown[]) => reconcileTrackersMock(...a),
}));
vi.mock('@/services/tracking/ingest', () => ({
  ingestPositions: (...a: unknown[]) => ingestPositionsMock(...a),
}));
vi.mock('@/services/tracking/alerts', () => ({
  raiseTrackingAlert: (...a: unknown[]) => raiseTrackingAlertMock(...a),
  alertRecipientCount: () => alertRecipientCountMock(),
}));

import { PartialFetchError } from '@/services/tracking/netstar/client';
import handler from '../poll-portal-tracking';

const SECRET = 'test-cron-secret';
const AUTH = { 'x-cron-secret': SECRET };

/**
 * Pinned-client stand-in, same shape as poll-tracking.test.ts's fake — the
 * advisory lock is acquired/released via pool.connect(), never via sql``.
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

function stubSql({
  watermarkRow = null as { last_event_ts: string | null } | null,
  failureConsecutive = 1,
  activeTrackers = 1,
} = {}) {
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('');
    if (text.includes('SELECT last_event_ts')) return watermarkRow ? [watermarkRow] : [];
    if (text.includes('RETURNING consecutive_failures')) return [{ consecutive_failures: failureConsecutive }];
    if (text.includes('FROM fleet_vehicle_trackers') && text.includes('count(*)')) return [{ n: activeTrackers }];
    return [];
  });
}

/**
 * A complete ReconcileReport. Built by a helper rather than spelled out inline
 * so a new field on the report cannot leave a mock silently missing it — which
 * is not cosmetic: pollProvider reads recon.ambiguous.length, and an undefined
 * there throws inside the per-provider try, turning a passing case into a
 * "provider failed" alert that looks like real behaviour.
 */
function recon(overrides: Record<string, unknown> = {}) {
  return {
    upserted: 0,
    deactivated: 0,
    portalOnly: [],
    fleetOnly: [],
    deactivationSuppressed: false,
    matchedNone: false,
    skippedOtherProvider: [],
    ambiguous: [],
    ...overrides,
  };
}

function makeFakeProvider(overrides: Partial<{
  key: string;
  accountRef: string;
  granularity: 'history' | 'snapshot';
  fetchPositions: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    key: overrides.key ?? 'netstar',
    accountRef: overrides.accountRef ?? 'europcar',
    granularity: overrides.granularity ?? 'snapshot',
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    fetchPositions: overrides.fetchPositions ?? vi.fn().mockResolvedValue([]),
  };
}

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'GET') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

describe('GET/POST /api/cron/poll-portal-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.NETSTAR_PORTAL_URL = 'https://portal.example.com';
    process.env.NETSTAR_PORTAL_USER = 'user';
    process.env.NETSTAR_PORTAL_PASS = 'pass';
    process.env.NETSTAR_ACCOUNT_REF = 'europcar';
    stubSql();
    poolConnectMock.mockImplementation(async () => makeFakeClient());
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
      // Fresh by default; the dead-feed cases override it.
      feedFreshness: vi.fn().mockResolvedValue(new Date()),
    });
    netstarProviderMock.mockReturnValue(makeFakeProvider());
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 1 }));
    ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0, maxIngestedAt: null });
    raiseTrackingAlertMock.mockResolvedValue(undefined);
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
    expect(reconcileTrackersMock).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), expect.anything());
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('acquires and releases the advisory lock on the SAME pinned connection, with a distinct key from poll-tracking', async () => {
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    await run(AUTH);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [4417302]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), [4417302]);
    expect(sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join('').includes('advisory'))).toBe(false);
  });

  it('always releases the pinned connection back to the pool, even when a provider throws', async () => {
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockRejectedValue(new Error('boom')), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
    await run(AUTH);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'), expect.anything());
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the unlock query itself fails — logs instead, and destroys the connection', async () => {
    const client = makeFakeClient();
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('pg_advisory_unlock')) throw new Error('connection reset');
      return { rows: [] };
    });
    poolConnectMock.mockImplementation(async () => client);
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.stringContaining('advisory unlock failed'),
      expect.objectContaining({ error: expect.stringContaining('connection reset') })
    );
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('returns the connection to the pool (does NOT destroy it) when the unlock succeeds', async () => {
    const client = makeFakeClient();
    poolConnectMock.mockImplementation(async () => client);
    await run(AUTH);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalledWith(true);
  });

  it('runs discovery (reconcileTrackers) before fetching positions, threaded with the portal vehicle list', async () => {
    const listVehicles = vi.fn().mockResolvedValue([{ externalId: '9', registration: 'CA1XYZ' }]);
    netstarClientMock.mockReturnValue({ listVehicles, feedFreshness: vi.fn().mockResolvedValue(new Date()) });
    await run(AUTH);
    expect(reconcileTrackersMock).toHaveBeenCalledWith(
      'netstar', 'europcar', [{ externalId: '9', registration: 'CA1XYZ' }]
    );
  });

  it('does not add a second empty-portal guard — reconcileTrackers governs, polling still proceeds for mapped vehicles', async () => {
    netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockResolvedValue([]), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 0 }));
    const fetchPositions = vi.fn().mockResolvedValue([]);
    netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    expect(fetchPositions).toHaveBeenCalledTimes(1);
  });

  it('cold start with no watermark backfills from 24 hours ago', async () => {
    const fetchPositions = vi.fn().mockResolvedValue([]);
    netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
    const before = Date.now();
    await run(AUTH);
    const [from, to] = fetchPositions.mock.calls[0] as [Date, Date];
    expect(to.getTime()).toBeGreaterThanOrEqual(before);
    expect(to.getTime() - from.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it('warm start re-polls from the watermark minus a 60-minute overlap', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-15T09:05:00.000Z'));
      const lastEventTs = '2026-07-15T07:00:00.000Z';
      stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
      const fetchPositions = vi.fn().mockResolvedValue([]);
      netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
      await run(AUTH);
      const [from] = fetchPositions.mock.calls[0] as [Date, Date];
      expect(from.getTime()).toBe(new Date(lastEventTs).getTime() - 60 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('threads provider.key AND provider.accountRef through to ingestPositions', async () => {
    const fakePositions = [{ externalId: '1' }];
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ accountRef: 'urent', fetchPositions: vi.fn().mockResolvedValue(fakePositions) })
    );
    await run(AUTH);
    expect(ingestPositionsMock).toHaveBeenCalledWith('netstar', 'urent', fakePositions);
  });

  it('reports inserted/skippedUnmapped/coverage per provider on success', async () => {
    ingestPositionsMock.mockResolvedValue({ inserted: 5, skippedUnmapped: 2, maxIngestedAt: null });
    reconcileTrackersMock.mockResolvedValue(recon({
      upserted: 1,
      portalOnly: [{ externalId: '9', registration: null }],
      fleetOnly: [{ id: 'v1', registration: 'CA1XYZ' }],
    }));
    const res = await run(AUTH);
    expect(res._getJSONData().data.results).toEqual([
      expect.objectContaining({
        provider: 'netstar', accountRef: 'europcar', inserted: 5, skippedUnmapped: 2,
        // `complete` distinguishes a full sweep from one that lost some
        // vehicles to failed reports — a partial tick still returns positions,
        // so without this the response cannot say which it was.
        complete: true,
        coverage: {
          mapped: 1, activeTrackers: 1,
          notOnPortal: ['CA1XYZ'], unknownOnPortalCount: 1, unknownOnPortal: ['9'],
          alreadyTrackedElsewhere: [], ambiguous: [], deactivationSuppressed: false,
        },
      }),
    ]);
  });

  it('raises a gap alert when the account-wide feed has gone stale', async () => {
    stubSql({ activeTrackers: 3 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 3 }));
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
      feedFreshness: vi.fn().mockResolvedValue(new Date(Date.now() - 8 * 60 * 60 * 1000)),
    });
    netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
    await run(AUTH);
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'gap', provider: 'netstar', accountRef: 'europcar' })
    );
  });

  it('does not raise a gap alert when nothing is mapped (empty portal already handled by reconcileTrackers)', async () => {
    stubSql({ activeTrackers: 0 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 0 }));
    netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
    await run(AUTH);
    expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
  });

  describe('gap alert: gated on currently-mapped trackers, not this tick\'s upsert count', () => {
    // The hole this closes: reconcileTrackers() short-circuits on an empty
    // portal list (by design), so recon.upserted is 0 both on a genuinely
    // fresh account AND on a dying session that never got as far as a real
    // vehicle list — the exact case that must not go silent.
    it('1. empty portal list + zero positions + mapped trackers exist -> alert raised', async () => {
      stubSql({ activeTrackers: 2 });
      netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockResolvedValue([]), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
      reconcileTrackersMock.mockResolvedValue(recon({ upserted: 0 }));
      netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
      await run(AUTH);
      expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'gap', detail: expect.stringContaining('empty vehicle list') })
      );
    });

    it('2. empty portal list + positions returned + mapped trackers exist -> alert raised', async () => {
      stubSql({ activeTrackers: 2 });
      netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockResolvedValue([]), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
      reconcileTrackersMock.mockResolvedValue(recon({ upserted: 0 }));
      netstarProviderMock.mockReturnValue(
        makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([{ externalId: '1' }]) })
      );
      await run(AUTH);
      expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'gap', detail: expect.stringContaining('empty vehicle list') })
      );
    });

    it('3. non-empty portal list + positions returned -> no alert', async () => {
      stubSql({ activeTrackers: 2 });
      netstarClientMock.mockReturnValue({
        listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'AB1CDGP' }]),
        feedFreshness: vi.fn().mockResolvedValue(new Date()),
      });
      reconcileTrackersMock.mockResolvedValue(recon({ upserted: 1 }));
      netstarProviderMock.mockReturnValue(
        makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([{ externalId: '1' }]) })
      );
      await run(AUTH);
      expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
    });

    it('4. genuinely zero mapped trackers (fresh account, nothing discovered yet) -> no alert', async () => {
      // This is what stops the fix from becoming a false alarm on first run,
      // before discovery has ever succeeded: there is nothing to be missing yet.
      stubSql({ activeTrackers: 0 });
      netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockResolvedValue([]), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
      reconcileTrackersMock.mockResolvedValue(recon({ upserted: 0 }));
      netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
      await run(AUTH);
      expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
    });
  });

  it('does not advance the watermark when a provider fails, and the failure does not blow up the tick', async () => {
    netstarClientMock.mockReturnValue({ listVehicles: vi.fn().mockRejectedValue(new Error('network down')), feedFreshness: vi.fn().mockResolvedValue(new Date()) });
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    const watermarkUpsert = sqlMock.mock.calls.find((c) =>
      (c[0] as TemplateStringsArray).join('').includes('INSERT INTO fleet_tracking_watermarks') &&
      (c[0] as TemplateStringsArray).join('').includes('last_error')
    );
    expect(watermarkUpsert).toBeDefined();
    expect((watermarkUpsert![0] as TemplateStringsArray).join('')).not.toContain('last_event_ts');
    expect(res._getJSONData().data.results[0]).toMatchObject({ provider: 'netstar', error: 'network down' });
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transient', consecutiveFailures: 1 })
    );
  });

  it('treats a Netstar login failure as an auth failure, not a generic one', async () => {
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockRejectedValue(new Error('[netstar] login failed: HTTP 403')),
      feedFreshness: vi.fn().mockResolvedValue(new Date()),
    });
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).toMatchObject({ authFailure: true });
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'auth' }));
  });

  it('treats "still logged out after re-auth" as an auth failure', async () => {
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockRejectedValue(new Error('[portal-session] still logged out after re-auth: /x')),
      feedFreshness: vi.fn().mockResolvedValue(new Date()),
    });
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).toMatchObject({ authFailure: true });
  });

  it('does not mark a generic failure as an auth failure', async () => {
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockRejectedValue(new Error('[netstar] Export: HTTP 500')),
      feedFreshness: vi.fn().mockResolvedValue(new Date()),
    });
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).toMatchObject({ authFailure: false });
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transient' }));
  });

  it('returns an empty results array when no provider is configured', async () => {
    delete process.env.NETSTAR_PORTAL_URL;
    const res = await run(AUTH);
    expect(res._getJSONData().data.results).toEqual([]);
    expect(reconcileTrackersMock).not.toHaveBeenCalled();
  });

  describe('missing credentials must not look like a healthy tick', () => {
    it('names the missing variables in a warning instead of returning a silent 200', async () => {
      delete process.env.NETSTAR_PORTAL_URL;
      delete process.env.NETSTAR_PORTAL_PASS;
      await run(AUTH);
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('netstar not configured'),
        expect.objectContaining({ missing: ['NETSTAR_PORTAL_URL', 'NETSTAR_PORTAL_PASS'] })
      );
    });

    it('reports providersConfigured: 0 in the response body', async () => {
      delete process.env.NETSTAR_PORTAL_USER;
      const res = await run(AUTH);
      expect(res._getJSONData().data).toMatchObject({ providersConfigured: 0, results: [] });
    });

    it('reports providersConfigured: 1 when the credentials are present', async () => {
      const res = await run(AUTH);
      expect(res._getJSONData().data.providersConfigured).toBe(1);
    });
  });

  describe('poll window is floored so a stale watermark cannot burst the partner account', () => {
    it('clamps a months-old watermark to 31 days and says so', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-07-15T09:00:00.000Z'));
        stubSql({ watermarkRow: { last_event_ts: '2026-01-01T00:00:00.000Z' } });
        const fetchPositions = vi.fn().mockResolvedValue([]);
        netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions }));
        await run(AUTH);
        const [from, to] = fetchPositions.mock.calls[0] as [Date, Date];
        expect(to.getTime() - from.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
        expect(logMock.warn).toHaveBeenCalledWith(
          expect.stringContaining('poll window clamped'),
          // watermark minus the 60-minute overlap, before the floor applies
          expect.objectContaining({
            requestedFrom: '2025-12-31T23:00:00.000Z',
            clampedFrom: '2026-06-14T09:00:00.000Z',
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves a normal warm-start window untouched and logs no clamp', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-07-15T09:05:00.000Z'));
        stubSql({ watermarkRow: { last_event_ts: '2026-07-15T07:00:00.000Z' } });
        netstarProviderMock.mockReturnValue(
          makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([{ externalId: '1' }]) })
        );
        await run(AUTH);
        expect(logMock.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('poll window clamped'), expect.anything()
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('gap streak is carried by consecutive_failures, so a sustained outage can be suppressed', () => {
    function gapWatermarkQuery() {
      return sqlMock.mock.calls.find((c) => {
        const text = (c[0] as TemplateStringsArray).join('');
        return text.includes('INSERT INTO fleet_tracking_watermarks')
          && text.includes('RETURNING consecutive_failures');
      });
    }

    it('increments rather than resets the counter on a gap tick', async () => {
      stubSql({ activeTrackers: 3, failureConsecutive: 4 });
      netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
      netstarClientMock.mockReturnValue({
        listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
        feedFreshness: vi.fn().mockResolvedValue(new Date(Date.now() - 8 * 60 * 60 * 1000)),
      });
      await run(AUTH);
      const q = gapWatermarkQuery();
      expect(q).toBeDefined();
      const text = (q?.[0] as TemplateStringsArray).join('');
      expect(text).toContain('consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1');
    });

    it('threads the bumped streak into the alert so decideAlert can suppress it', async () => {
      stubSql({ activeTrackers: 3, failureConsecutive: 4 });
      netstarProviderMock.mockReturnValue(makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([]) }));
      netstarClientMock.mockReturnValue({
        listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
        feedFreshness: vi.fn().mockResolvedValue(new Date(Date.now() - 8 * 60 * 60 * 1000)),
      });
      await run(AUTH);
      expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'gap', consecutiveFailures: 4 })
      );
    });

    it('resets the counter to 0 on a healthy tick, so the next gap alerts immediately', async () => {
      stubSql({ activeTrackers: 3 });
      netstarProviderMock.mockReturnValue(
        makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue([{ externalId: '1' }]) })
      );
      await run(AUTH);
      expect(gapWatermarkQuery()).toBeUndefined();
      const healthy = sqlMock.mock.calls.find((c) =>
        (c[0] as TemplateStringsArray).join('').includes('INSERT INTO fleet_tracking_watermarks'));
      expect((healthy?.[0] as TemplateStringsArray).join('')).toContain('consecutive_failures = 0');
      expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
    });
  });

  describe('watermark write: pins the value written to last_event_ts', () => {
    function successUpsertValue(): unknown {
      const call = sqlMock.mock.calls.find((c) => {
        const text = (c[0] as TemplateStringsArray).join('');
        return text.includes('INSERT INTO fleet_tracking_watermarks') && text.includes('last_event_ts');
      });
      if (!call) throw new Error('no success-path watermark upsert found');
      return call[3];
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

    it('stays null on a cold-start all-unmapped batch — does not fabricate a watermark', async () => {
      ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 1, maxIngestedAt: null });
      await run(AUTH);
      expect(successUpsertValue()).toBeNull();
    });
  });

/**
 * Discovery health is not inferable from position volume.
 *
 * provider.fetchPositions reads ALREADY-MAPPED trackers, so when a portal
 * reformat makes the vehicle list match nothing, positions keep arriving from
 * the previous tick's mappings. A volume-only gap check therefore stays quiet
 * forever while every newly added or renamed vehicle silently stops being
 * trackable — and the wholesale-unmapping brake, the single most important
 * thing this job can report, only ever reached a log line.
 */
describe('gap alert: discovery failures are alerts, not just log lines', () => {
  const positions = [{ externalId: '1' }];

  it('alerts when the portal returned vehicles but none could be mapped', async () => {
    stubSql({ activeTrackers: 5 });
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockResolvedValue([
        { externalId: '900', registration: 'Europcar Gauteng' },
      ]),
      feedFreshness: vi.fn().mockResolvedValue(new Date()),
    });
    reconcileTrackersMock.mockResolvedValue(recon({ matchedNone: true }));
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue(positions) })
    );

    await run(AUTH);

    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'gap',
        detail: expect.stringContaining('none could be mapped'),
      })
    );
  });

  it('alerts when the deactivation brake engaged', async () => {
    stubSql({ activeTrackers: 10 });
    reconcileTrackersMock.mockResolvedValue(
      recon({ upserted: 2, deactivationSuppressed: true })
    );
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue(positions) })
    );

    await run(AUTH);

    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'gap',
        detail: expect.stringContaining('refused to unmap'),
      })
    );
  });

  it('stays quiet on a healthy tick that mapped everything and returned data', async () => {
    stubSql({ activeTrackers: 5 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 5 }));
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue(positions) })
    );

    await run(AUTH);

    expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
  });
});

/**
 * A partly-covered window must not move the watermark.
 *
 * The positions that arrived are worth storing, but the vehicles whose reports
 * failed were never fetched for that window — and the watermark is per account,
 * not per vehicle. Advancing it would skip that window for them permanently.
 */
describe('partial fetch', () => {
  const RECOVERED = [{ externalId: '1' }];

  function partialProvider() {
    return makeFakeProvider({
      fetchPositions: vi.fn().mockRejectedValue(
        new PartialFetchError('[netstar] 1 of 3 vehicle reports failed', RECOVERED, [
          { externalId: '222', error: 'HTTP 500' },
        ])
      ),
    });
  }

  it('still ingests the positions that arrived', async () => {
    netstarProviderMock.mockReturnValue(partialProvider());
    await run(AUTH);
    expect(ingestPositionsMock).toHaveBeenCalledWith('netstar', 'europcar', RECOVERED);
  });

  it('holds the watermark at its previous value instead of advancing it', async () => {
    const lastEventTs = '2026-08-05T07:00:00.000Z';
    stubSql({ watermarkRow: { last_event_ts: lastEventTs } });
    ingestPositionsMock.mockResolvedValue({
      inserted: 1, skippedUnmapped: 0,
      // A later maxIngestedAt that must NOT be adopted, because the window was
      // only partly covered.
      maxIngestedAt: new Date('2026-08-05T11:00:00.000Z'),
    });
    netstarProviderMock.mockReturnValue(partialProvider());

    await run(AUTH);

    const watermarkWrite = sqlMock.mock.calls.find((c) =>
      (c[0] as TemplateStringsArray).join('').includes('INSERT INTO fleet_tracking_watermarks')
    );
    expect(watermarkWrite).toBeDefined();
    const written = watermarkWrite!.slice(1).find((v) => v instanceof Date) as Date | undefined;
    expect(written?.toISOString()).toBe(lastEventTs);
  });

  it('reports the tick as incomplete and raises a transient alert', async () => {
    netstarProviderMock.mockReturnValue(partialProvider());
    const res = await run(AUTH);

    expect(res._getJSONData().data.results[0]).toMatchObject({ complete: false });
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transient', detail: expect.stringContaining('1 of 3') })
    );
  });

  it('does not treat a partial fetch as a provider failure', async () => {
    // The old behaviour: any throw out of fetchPositions took the whole tick
    // down and discarded every other vehicle's positions.
    netstarProviderMock.mockReturnValue(partialProvider());
    const res = await run(AUTH);
    expect(res._getJSONData().data.results[0]).not.toHaveProperty('error');
  });
});

describe('alert recipients are visible in the response', () => {
  it('reports 0 when FLEET_ALERT_USER_IDS is unset, so a dead alert path is not silent', async () => {
    alertRecipientCountMock.mockReturnValue(0);
    const res = await run(AUTH);
    expect(res._getJSONData().data.alertRecipients).toBe(0);
  });
});

/**
 * The dead-feed detector.
 *
 * Under a snapshot provider the portal keeps returning the same stale fix
 * forever, so `positions.length === 0` — the old gap condition — is
 * structurally unreachable and a frozen tree reads exactly like a healthy one.
 * The account-wide freshness probe is what separates them.
 */
describe('dead feed detection for snapshot providers', () => {
  const positions = [{ externalId: '1' }];

  function withFreshness(at: Date | null) {
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
      feedFreshness: vi.fn().mockResolvedValue(at),
    });
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ fetchPositions: vi.fn().mockResolvedValue(positions) })
    );
  }

  it('alerts when the newest fix on the whole account is hours old', async () => {
    stubSql({ activeTrackers: 6 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 6 }));
    withFreshness(new Date(Date.now() - 8 * 60 * 60 * 1000));

    await run(AUTH);

    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'gap', detail: expect.stringContaining('feed is stale') })
    );
  });

  // The exact regression the old detector could not see: the portal answers,
  // returns data, and every fix in it is frozen.
  it('does NOT stay silent just because stale positions keep arriving', async () => {
    stubSql({ activeTrackers: 6 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 6 }));
    withFreshness(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const res = await run(AUTH);

    expect(res._getJSONData().data.results[0]).not.toHaveProperty('error');
    expect(raiseTrackingAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'gap' })
    );
  });

  it('stays quiet when the account is fresh, even if OUR vehicles are parked', async () => {
    // A parked fleet is not an outage. The probe spans ~11.5k vehicles across
    // several commercial fleets, so something has always reported recently.
    stubSql({ activeTrackers: 6 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 6 }));
    withFreshness(new Date(Date.now() - 30 * 60 * 1000));

    await run(AUTH);

    expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
  });

  it('does not apply the freshness rule to history providers', async () => {
    // For a history provider an empty window genuinely means nothing happened,
    // and it has no account-wide probe to consult.
    stubSql({ activeTrackers: 6 });
    reconcileTrackersMock.mockResolvedValue(recon({ upserted: 6 }));
    netstarClientMock.mockReturnValue({
      listVehicles: vi.fn().mockResolvedValue([{ externalId: '1', registration: 'ND01ABGP' }]),
      feedFreshness: vi.fn().mockResolvedValue(new Date(Date.now() - 8 * 60 * 60 * 1000)),
    });
    netstarProviderMock.mockReturnValue(
      makeFakeProvider({ granularity: 'history', fetchPositions: vi.fn().mockResolvedValue(positions) })
    );

    await run(AUTH);

    expect(raiseTrackingAlertMock).not.toHaveBeenCalled();
  });
});
});

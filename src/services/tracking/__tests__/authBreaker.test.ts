/**
 * The auth circuit breaker.
 *
 * Portal logins are rate-limited by the far side, and Cartrack's ct_login
 * enforces a hard account lockout at ~20 failures. A credential that has gone
 * bad fails identically every tick, so without a breaker a 2-hourly cron burns
 * that budget in under two days and loses the account permanently. These tests
 * assert the provider is not called at all once the breaker is open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
const reconcileTrackersMock = vi.fn();
const ingestPositionsMock = vi.fn();
const raiseTrackingAlertMock = vi.fn();

vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a), pool: {} }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/tracking/discovery', () => ({
  reconcileTrackers: (...a: unknown[]) => reconcileTrackersMock(...a),
}));
vi.mock('@/services/tracking/ingest', async () => {
  const actual = await vi.importActual<typeof import('@/services/tracking/ingest')>(
    '@/services/tracking/ingest'
  );
  return { ...actual, ingestPositions: (...a: unknown[]) => ingestPositionsMock(...a) };
});
vi.mock('@/services/tracking/alerts', () => ({
  raiseTrackingAlert: (...a: unknown[]) => raiseTrackingAlertMock(...a),
  alertRecipientCount: () => 1,
}));

import { pollProvider } from '@/services/tracking/pollProvider';

/** A watermark row as the first query in pollProvider would return it. */
function watermark(consecutive_failures: number, last_error: string | null) {
  return [{ last_event_ts: new Date('2026-08-07T10:00:00Z'), consecutive_failures, last_error }];
}

function entry(listVehicles = vi.fn()) {
  return {
    provider: {
      key: 'cartrack' as const,
      accountRef: 'urent',
      granularity: 'snapshot' as const,
      maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
      fetchPositions: vi.fn(async () => []),
    },
    listVehicles,
    feedFreshness: vi.fn(async () => new Date()),
  };
}

const AUTH_ERR = '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS, attempts_remaining=17';

beforeEach(() => {
  vi.clearAllMocks();
  reconcileTrackersMock.mockResolvedValue({
    matched: [], portalOnly: [], fleetOnly: [], ambiguous: [],
    upserted: 0, deactivated: 0, deactivationSuppressed: false, skippedOtherProvider: [],
  });
  ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0, maxIngestedAt: null });
});

describe('auth circuit breaker', () => {
  it('does NOT call the provider once the threshold of auth failures is reached', async () => {
    sqlMock.mockResolvedValueOnce(watermark(3, AUTH_ERR));
    const listVehicles = vi.fn();
    const result = await pollProvider(entry(listVehicles));

    // The whole point: no login is attempted, so no lockout budget is spent.
    expect(listVehicles).not.toHaveBeenCalled();
    expect(reconcileTrackersMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'cartrack', accountRef: 'urent',
      skipped: 'auth-circuit-open', consecutiveFailures: 3,
    });
  });

  it('still alerts while open — the breaker stops retries, not reporting', async () => {
    // An open breaker means this account is ingesting nothing at all. Silence
    // would be worse than the retries it replaces.
    sqlMock.mockResolvedValueOnce(watermark(5, AUTH_ERR));
    await pollProvider(entry());
    expect(raiseTrackingAlertMock).toHaveBeenCalledTimes(1);
    expect(raiseTrackingAlertMock.mock.calls[0]![0]).toMatchObject({
      kind: 'auth', provider: 'cartrack', accountRef: 'urent', consecutiveFailures: 5,
    });
  });

  it('stays CLOSED below the threshold, so a genuine blip still retries', async () => {
    sqlMock.mockResolvedValue([]);
    sqlMock.mockResolvedValueOnce(watermark(2, AUTH_ERR));
    const listVehicles = vi.fn(async () => [{ externalId: '1', registration: 'AA11AAGP' }]);
    await pollProvider(entry(listVehicles));
    expect(listVehicles).toHaveBeenCalledTimes(1);
  });

  it('stays CLOSED for a non-auth failure streak, however long', async () => {
    // A gap or network streak also increments consecutive_failures, but those
    // can self-heal and must keep being retried. Only credentials open it.
    sqlMock.mockResolvedValue([]);
    sqlMock.mockResolvedValueOnce(watermark(50, '[cartrack-portal/network] ECONNRESET'));
    const listVehicles = vi.fn(async () => [{ externalId: '1', registration: 'AA11AAGP' }]);
    await pollProvider(entry(listVehicles));
    expect(listVehicles).toHaveBeenCalledTimes(1);
    expect(raiseTrackingAlertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('auth circuit open') })
    );
  });

  it('stays CLOSED when there is no watermark row at all (fresh account)', async () => {
    sqlMock.mockResolvedValue([]);
    const listVehicles = vi.fn(async () => [{ externalId: '1', registration: 'AA11AAGP' }]);
    await pollProvider(entry(listVehicles));
    expect(listVehicles).toHaveBeenCalledTimes(1);
  });
});

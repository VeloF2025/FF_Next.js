/**
 * The auth circuit breaker.
 *
 * Cartrack's ct_login locks an account out after ~20 failures, so a 2-hourly
 * cron retrying a dead credential loses the data source in under two days. But
 * a breaker that ONLY skips is worse than the bug: the skip returns before any
 * watermark write, so consecutive_failures freezes and the only path that could
 * clear it is the one being blocked. These tests pin both halves — that it
 * stops the retries, AND that it can still let go.
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

import {
  AUTH_HARD_STOP,
  AUTH_PROBE_COOLDOWN_MS,
  authBreakerDecision,
} from '@/services/tracking/authBreaker';
import { pollProvider } from '@/services/tracking/pollProvider';

const AUTH_ERR = '[cartrack-portal/auth] login failed: status=WRONG_CREDENTIALS, attempts_remaining=17';
const NET_ERR = '[cartrack-portal/network] ECONNRESET';
const NOW = new Date('2026-08-07T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('authBreakerDecision — the state machine', () => {
  it('is closed below the failure threshold', () => {
    expect(authBreakerDecision(2, AUTH_ERR, ago(0), NOW)).toEqual({ state: 'closed' });
  });

  it('is closed for a NON-auth streak however long', () => {
    // Transient and gap failures also increment the counter, and they can
    // self-heal, so throttling them would suppress a recoverable provider.
    expect(authBreakerDecision(500, NET_ERR, ago(0), NOW)).toEqual({ state: 'closed' });
  });

  it('is open inside the cooldown, and says how long is left', () => {
    const d = authBreakerDecision(3, AUTH_ERR, ago(6 * 3600_000), NOW);
    expect(d.state).toBe('open');
    expect((d as { retryInMs: number }).retryInMs).toBe(AUTH_PROBE_COOLDOWN_MS - 6 * 3600_000);
  });

  it('goes HALF-OPEN once the cooldown elapses — this is what breaks the latch', () => {
    expect(authBreakerDecision(3, AUTH_ERR, ago(AUTH_PROBE_COOLDOWN_MS), NOW))
      .toEqual({ state: 'half-open', failures: 3 });
  });

  it('probes rather than latching when last_run_at is missing', () => {
    expect(authBreakerDecision(5, AUTH_ERR, null, NOW).state).toBe('half-open');
  });

  it('hard-stops at the ceiling, even once the cooldown has elapsed', () => {
    // Nine daily probes have all been rejected; continuing would eventually
    // reach the vendor lockout, which is the one unrecoverable outcome.
    expect(authBreakerDecision(AUTH_HARD_STOP, AUTH_ERR, ago(30 * 24 * 3600_000), NOW))
      .toEqual({ state: 'hard-stop', failures: AUTH_HARD_STOP });
  });

  it('spends at most 12 vendor attempts over nine days', () => {
    // The whole justification for the numbers. Unthrottled, a 2-hourly cron
    // spends 12 attempts in a single day.
    let attempts = 0;
    let failures = 0;
    let lastRun: Date | null = null;
    for (let tick = 0; tick < 12 * 30; tick++) {           // 30 days at 2-hourly
      const at = new Date(NOW.getTime() + tick * 2 * 3600_000);
      const d = authBreakerDecision(failures, failures ? AUTH_ERR : null, lastRun, at);
      if (d.state === 'open' || d.state === 'hard-stop') continue;
      attempts += 1;                                        // a real login happens
      failures += 1;
      lastRun = at;
    }
    expect(attempts).toBe(AUTH_HARD_STOP);
  });
});

function watermark(consecutive_failures: number, last_error: string | null, last_run_at: Date | null) {
  return [{ last_event_ts: new Date('2026-08-07T10:00:00Z'), consecutive_failures, last_error, last_run_at }];
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

beforeEach(() => {
  vi.clearAllMocks();
  reconcileTrackersMock.mockResolvedValue({
    matched: [], portalOnly: [], fleetOnly: [], ambiguous: [],
    upserted: 0, deactivated: 0, deactivationSuppressed: false, skippedOtherProvider: [],
  });
  ingestPositionsMock.mockResolvedValue({ inserted: 0, skippedUnmapped: 0, maxIngestedAt: null });
});

describe('pollProvider — breaker integration', () => {
  it('does not call the provider while open', async () => {
    sqlMock.mockResolvedValueOnce(watermark(3, AUTH_ERR, new Date()));
    const listVehicles = vi.fn();
    const result = await pollProvider(entry(listVehicles));
    expect(listVehicles).not.toHaveBeenCalled();
    expect(reconcileTrackersMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 'auth-circuit-open', consecutiveFailures: 3 });
  });

  it('DOES call the provider on the probe tick once the cooldown elapsed', async () => {
    // The regression that matters: without this the breaker is a one-way latch
    // and a fixed credential never gets discovered.
    sqlMock.mockResolvedValue([]);
    sqlMock.mockResolvedValueOnce(
      watermark(5, AUTH_ERR, new Date(Date.now() - AUTH_PROBE_COOLDOWN_MS - 1000)));
    const listVehicles = vi.fn(async () => [{ externalId: '1', registration: 'AA11AAGP' }]);
    await pollProvider(entry(listVehicles));
    expect(listVehicles).toHaveBeenCalledTimes(1);
  });

  it('hard-stop names the exact SQL to clear it, and does not promise self-healing', async () => {
    // The previous version told operators the next successful tick would close
    // the breaker. It could not — the breaker blocked that tick.
    sqlMock.mockResolvedValueOnce(watermark(AUTH_HARD_STOP, AUTH_ERR, new Date(0)));
    const result = await pollProvider(entry()) as { skipped: string };
    expect(result.skipped).toBe('auth-circuit-hard-stop');
    const detail = String(raiseTrackingAlertMock.mock.calls[0]![0].detail);
    expect(detail).toContain('UPDATE fleet_tracking_watermarks');
    expect(detail).toContain("account_ref = 'urent'");
    expect(detail).not.toContain('closes the breaker automatically');
  });

  it('still alerts while throttled — the breaker stops retries, not reporting', async () => {
    sqlMock.mockResolvedValueOnce(watermark(4, AUTH_ERR, new Date()));
    await pollProvider(entry());
    expect(raiseTrackingAlertMock).toHaveBeenCalledTimes(1);
    expect(raiseTrackingAlertMock.mock.calls[0]![0]).toMatchObject({ kind: 'auth' });
  });

  it('polls normally on a fresh account with no watermark row', async () => {
    sqlMock.mockResolvedValue([]);
    const listVehicles = vi.fn(async () => [{ externalId: '1', registration: 'AA11AAGP' }]);
    await pollProvider(entry(listVehicles));
    expect(listVehicles).toHaveBeenCalledTimes(1);
  });
});

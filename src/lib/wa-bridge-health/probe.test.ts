import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({
  log: {
    warn: (...args: unknown[]) => warn(...args),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  probeBridgeHealth,
  probeBudgetMs,
  resolveProbeConfig,
  CALLER_BUDGET_MS,
  DEFAULT_BRIDGE_HEALTH_URL,
} from './probe';

const HEALTHY = {
  connected: true, session_valid: true, needs_auth: false,
  phone_number: '+27638412276', status: 'ok',
};

/** The payload the bridge actually serves while sitting on the pairing screen. */
const LOGGED_OUT = {
  connected: true, session_valid: false, needs_auth: true,
  phone_number: 'unknown', status: 'ok',
};

function ok(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}
function httpError(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

/** No real waiting in tests — the backoff policy is asserted, not slept through. */
const noSleep = vi.fn().mockResolvedValue(undefined);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('probeBridgeHealth', () => {
  it('returns the payload on a first-attempt success without sleeping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(HEALTHY));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.payload).toEqual(HEALTHY);
    expect(result.attempts).toBe(1);
    expect(result.lastFailure).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  // The whole point of the change: one stalled request on the velo -> VPS path
  // produced 124 false "ACTION NEEDED" pages between 2026-08-03 and 2026-08-20.
  it('recovers from a transient network failure instead of reporting it', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('The operation was aborted'))
      .mockResolvedValue(ok(HEALTHY));

    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.payload).toEqual(HEALTHY);
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  // A 502 from the nginx in front of the bridge is the same class of blip as a
  // dropped packet. The previous code collapsed it straight into a page.
  it('retries a transient HTTP error rather than paging on it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(httpError(502))
      .mockResolvedValue(ok(HEALTHY));

    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });
    expect(result.payload).toEqual(HEALTHY);
    expect(result.attempts).toBe(2);
  });

  it('gives up after the configured attempts and reports why', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep, attempts: 3 });

    expect(result.payload).toBeNull();
    expect(result.attempts).toBe(3);
    expect(result.lastFailure).toContain('ECONNREFUSED');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Two gaps between three attempts, and none after the last — sleeping there
    // would only delay the verdict.
    expect(noSleep).toHaveBeenCalledTimes(2);
  });

  // Retrying must not slow down the detection this monitor exists for: a
  // logged-out bridge ANSWERS, so it is classified on the first attempt.
  it('does not retry a logged-out bridge, which answers on the first attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(LOGGED_OUT));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.payload).toEqual(LOGGED_OUT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-object payload rather than casting it into every-field-undefined', async () => {
    // This shape would otherwise classify as logged_out — a false page in the
    // opposite direction, which would burn pairing codes on a healthy bridge.
    const fetchImpl = vi.fn().mockResolvedValue(ok('not-an-object'));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep, attempts: 1 });

    expect(result.payload).toBeNull();
    expect(result.lastFailure).toContain('unexpected payload shape');
  });

  it('rejects an array payload too', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([]));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep, attempts: 1 });
    expect(result.payload).toBeNull();
    expect(result.lastFailure).toContain('array');
  });

  it('aborts an attempt that exceeds the per-attempt timeout', async () => {
    // Never resolves on its own; only the AbortSignal can end it.
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    ) as unknown as typeof fetch;

    const result = await probeBridgeHealth({
      fetchImpl, sleep: noSleep, attempts: 2, timeoutMs: 10,
    });

    expect(result.payload).toBeNull();
    expect(result.lastFailure).toContain('aborted');
  });

  it('reports each failed attempt so a degrading path is visible before it breaks', async () => {
    const onAttemptFailure = vi.fn();
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(ok(HEALTHY));

    await probeBridgeHealth({ fetchImpl, sleep: noSleep, onAttemptFailure });

    expect(onAttemptFailure).toHaveBeenCalledTimes(1);
    expect(onAttemptFailure).toHaveBeenCalledWith({ attempt: 1, reason: 'timeout' });
  });
});

describe('probeBridgeHealth configuration', () => {
  it('defaults to the production bridge when no URL is configured', async () => {
    delete process.env.WA_BRIDGE_HEALTH_URL;
    const fetchImpl = vi.fn().mockResolvedValue(ok(HEALTHY));
    await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledWith(DEFAULT_BRIDGE_HEALTH_URL, expect.anything());
  });

  it('honours WA_BRIDGE_HEALTH_URL', async () => {
    process.env.WA_BRIDGE_HEALTH_URL = 'http://example.test/health';
    const fetchImpl = vi.fn().mockResolvedValue(ok(HEALTHY));
    await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledWith('http://example.test/health', expect.anything());
  });

  // Shorter per-attempt timeout so five attempts still fit the caller budget;
  // asking for five at the default 5 s would be shed back to four, which is the
  // clamp doing its job rather than env tuning failing.
  it('reads the attempt count from env so a bad week needs no deploy', async () => {
    process.env.WA_BRIDGE_PROBE_ATTEMPTS = '5';
    process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '2000';
    const fetchImpl = vi.fn().mockRejectedValue(new Error('nope'));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.attempts).toBe(5);
  });

  // A typo in an env var must not silently disable the monitor.
  it('falls back to the default when the env value is not a usable number', async () => {
    process.env.WA_BRIDGE_PROBE_ATTEMPTS = 'three';
    const fetchImpl = vi.fn().mockRejectedValue(new Error('nope'));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.attempts).toBe(3);
  });

  it('always makes at least one attempt even if configured to zero', async () => {
    process.env.WA_BRIDGE_PROBE_ATTEMPTS = '0';
    const fetchImpl = vi.fn().mockResolvedValue(ok(HEALTHY));
    const result = await probeBridgeHealth({ fetchImpl, sleep: noSleep });

    expect(result.attempts).toBe(1);
    expect(result.payload).toEqual(HEALTHY);
  });

  // Worst case must stay inside the 30s the velo cron's `curl -m 30` allows.
  // Derived from the REAL resolved config, not from literals restating the
  // defaults — the earlier version of this test recomputed 3 * 5000 + 2 * 1500
  // from its own copies and so kept passing no matter what the defaults became.
  it('keeps its worst-case wall time inside the caller budget on the defaults', () => {
    expect(probeBudgetMs(resolveProbeConfig())).toBeLessThan(CALLER_BUDGET_MS);
  });

  it('clamps an oversized env config back inside the caller budget', () => {
    process.env.WA_BRIDGE_PROBE_ATTEMPTS = '999';
    process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '600000';
    process.env.WA_BRIDGE_PROBE_BACKOFF_MS = '600000';

    const config = resolveProbeConfig();

    expect(probeBudgetMs(config)).toBeLessThan(CALLER_BUDGET_MS);
    expect(config.attempts).toBeGreaterThanOrEqual(1);
  });

  it('floors a too-small timeout, which would fail every attempt instantly', () => {
    process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '1';
    expect(resolveProbeConfig().timeoutMs).toBeGreaterThanOrEqual(500);
  });

  it('still makes one full-timeout attempt when the budget forces attempts down', () => {
    process.env.WA_BRIDGE_PROBE_ATTEMPTS = '5';
    process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '15000';

    const config = resolveProbeConfig();

    expect(config.attempts).toBe(1);
    expect(config.timeoutMs).toBe(15_000);
  });

  // The clamp defends against an operator typo in an env file that nothing
  // type-checks. An explicit argument is code, written deliberately, and
  // handing back something other than what was asked for is its own trap — so
  // the two paths must behave differently, and that difference needs pinning.
  describe('clamping applies to env, not to explicit arguments', () => {
    it('honours an explicit attempts count instead of shedding it to fit', () => {
      // Same numbers via env would shed to 1; passed explicitly they stand.
      const config = resolveProbeConfig({ attempts: 5, timeoutMs: 15_000 });

      expect(config.attempts).toBe(5);
      expect(probeBudgetMs(config)).toBeGreaterThan(CALLER_BUDGET_MS);
    });

    it('honours an explicit timeout below the env floor', () => {
      process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '1';

      expect(resolveProbeConfig({ timeoutMs: 10 }).timeoutMs).toBe(10);
      // ...while the env value on the same run is still floored.
      expect(resolveProbeConfig().timeoutMs).toBe(500);
    });

    it('honours an explicit backoff above the env ceiling', () => {
      expect(resolveProbeConfig({ backoffMs: 60_000 }).backoffMs).toBe(60_000);
      process.env.WA_BRIDGE_PROBE_BACKOFF_MS = '60000';
      expect(resolveProbeConfig().backoffMs).toBe(5_000);
    });

    it('warns rather than shedding env attempts in silence', () => {
      process.env.WA_BRIDGE_PROBE_ATTEMPTS = '5';
      process.env.WA_BRIDGE_PROBE_TIMEOUT_MS = '15000';

      resolveProbeConfig();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('attempts reduced'),
        expect.objectContaining({ requested: 5, attempts: 1 }),
        expect.anything(),
      );
    });

    it('does not warn when the env config already fits', () => {
      resolveProbeConfig();
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('attempts reduced'),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});

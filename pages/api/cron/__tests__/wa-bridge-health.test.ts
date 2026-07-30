import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const dispatchBridgeAlert = vi.fn();
vi.mock('@/lib/wa-bridge-health/alert', () => ({
  dispatchBridgeAlert: (...args: unknown[]) => dispatchBridgeAlert(...args),
}));

import handler, { __resetStateForTests } from '../wa-bridge-health';

const SECRET = 'test-cron-secret';

const HEALTHY = {
  connected: true, session_valid: true, needs_auth: false,
  phone_number: '+27638412276', status: 'ok',
};
const LOGGED_OUT = {
  connected: true, session_valid: false, needs_auth: true,
  phone_number: 'unknown', status: 'ok',
};
const DISCONNECTED = {
  connected: false, session_valid: true, needs_auth: false,
  phone_number: '+27638412276', status: 'ok',
};

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: any };
}

function req(overrides: Partial<NextApiRequest> = {}) {
  return {
    method: 'GET',
    headers: { 'x-cron-secret': SECRET },
    ...overrides,
  } as unknown as NextApiRequest;
}

/** Make the bridge probe resolve to a given payload, or fail outright. */
function bridgeReturns(payload: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 502, json: async () => payload,
  }));
}
function bridgeUnreachable() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  __resetStateForTests();
  process.env.CRON_SECRET = SECRET;
  dispatchBridgeAlert.mockResolvedValue({ delivered: ['email'], problems: [] });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('auth', () => {
  it('rejects a wrong secret', async () => {
    bridgeReturns(HEALTHY);
    const res = mockRes();
    await handler(req({ headers: { 'x-cron-secret': 'nope' } }), res);
    expect(res.statusCode).toBe(401);
    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });

  it('rejects a missing secret header', async () => {
    bridgeReturns(HEALTHY);
    const res = mockRes();
    await handler(req({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  // Fail CLOSED: an unauthenticated caller here triggers real email and
  // WhatsApp sends, so a misconfigured server must disable the endpoint.
  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    bridgeReturns(HEALTHY);
    const res = mockRes();
    await handler(req({ headers: {} }), res);
    expect(res.statusCode).toBe(503);
    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });

  it('rejects non-GET', async () => {
    const res = mockRes();
    await handler(req({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});

describe('verdicts', () => {
  it('returns 200 and does not alert when healthy', async () => {
    bridgeReturns(HEALTHY);
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.verdict).toBe('healthy');
    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });

  it('returns 503 and alerts on logout', async () => {
    bridgeReturns(LOGGED_OUT);
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.verdict).toBe('logged_out');
    expect(res.body.needsHuman).toBe(true);
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();
  });

  it('treats an unreachable bridge as unreachable, not healthy', async () => {
    bridgeUnreachable();
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.verdict).toBe('unreachable');
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();
  });

  it('treats a non-2xx bridge response as unreachable', async () => {
    bridgeReturns({}, false);
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.verdict).toBe('unreachable');
  });

  it('treats a non-object payload as unreachable rather than casting it', async () => {
    bridgeReturns('not-an-object');
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.verdict).toBe('unreachable');
  });
});

describe('alert debounce', () => {
  // The bug this file exists to prevent: if both channels fail, the handler
  // must NOT record an alert, or it silences itself for 30 minutes and
  // recreates the "nobody was told" outage.
  it('does not start the quiet period when every channel failed', async () => {
    dispatchBridgeAlert.mockResolvedValue({ delivered: [], problems: ['email: down', 'whatsapp: down'] });
    bridgeReturns(LOGGED_OUT);

    const first = mockRes();
    await handler(req(), first);
    expect(first.body.alerted).toBe(false);
    expect(first.body.alertProblems).toHaveLength(2);

    // Next tick must try again immediately, not wait out REALERT_MS.
    const second = mockRes();
    await handler(req(), second);
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
  });

  it('suppresses a repeat alert while the same outage continues', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    await handler(req(), mockRes());
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);
  });

  // Keying off "verdict changed" would alert on every tick while flapping.
  it('does not re-alert on every flap between two alerting verdicts', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());          // escalates: needsHuman
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);
  });

  it('alerts again once the re-alert interval has elapsed', async () => {
    vi.useFakeTimers();
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
  });

  // A disconnect that becomes a logout is a real escalation: it changes the
  // remedy from "wait" to "someone must hold the handset".
  it('alerts immediately when a disconnect escalates to a logout', async () => {
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);

    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
  });
});

describe('recovery', () => {
  it('sends an all-clear after an outage, then stays quiet', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);

    bridgeReturns(HEALTHY);
    const recovered = mockRes();
    await handler(req(), recovered);
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
    expect(String(dispatchBridgeAlert.mock.calls[1][0])).toContain('RECOVERED');
    expect(recovered.statusCode).toBe(200);

    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
  });

  it('does not send an all-clear when it was never down', async () => {
    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });

  // After recovery the next outage must alert immediately, not inherit the
  // previous outage's quiet period.
  it('alerts immediately on a fresh outage after a recovery', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(3);
  });
});

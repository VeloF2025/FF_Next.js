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
  // The probe retries; without this the suite would sit through real backoffs.
  process.env.WA_BRIDGE_PROBE_BACKOFF_MS = '0';
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

  // Still classified as unreachable on the first tick — it is only the ALERT
  // that waits for confirmation. Defaulting to healthy here is the regression
  // that would hide a real outage.
  it('treats an unreachable bridge as unreachable, not healthy', async () => {
    bridgeUnreachable();
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.verdict).toBe('unreachable');
    expect(res.statusCode).toBe(503);
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
    expect(first.body.alertProblemCount).toBe(2);
    expect(first.body.alertChannels).toEqual([]);
    // Raw transport errors must not reach the response body.
    expect(JSON.stringify(first.body)).not.toContain('down');

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

  // Keying off "verdict changed" would alert on all four ticks. Only a RISE
  // into needs-a-human pages; the de-escalating ticks stay quiet. Two alerts
  // across four ticks, not four — and not one, which would mean a real second
  // escalation was being swallowed.
  it('alerts only on the rises when flapping between two alerting verdicts', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());          // rise -> alert
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());          // de-escalate -> quiet
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());          // rise again -> alert
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());          // de-escalate -> quiet
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
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

  // Regression (round-2 review): escalation must compare against the PREVIOUS
  // TICK, not the last alert. Keying off the last alert made this exact
  // sequence silent — a fresh "a human must act" state folded into the first
  // outage's 30-minute quiet window.
  it('alerts again when it de-escalates then re-escalates to needing a human', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());                    // tick 1: alert
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);

    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());                    // tick 2: de-escalate, quiet
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(1);

    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());                    // tick 3: fresh escalation
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


// Regression, 2026-08-20. 124 `unreachable` pages between 2026-08-03 and
// 2026-08-20, every one of them false: the bridge ran 20 days with zero
// restarts and its on-box healthcheck logged `healthy` at the exact minute of
// each page. Median velo -> VPS round trip is ~320 ms against an 8 s single-shot
// budget, so these were stalls on the path, not the bridge.
describe('unreachable confirmation gate', () => {
  it('does not page on a single unreachable tick', async () => {
    bridgeUnreachable();
    const res = mockRes();
    await handler(req(), res);

    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
    expect(res.body.alertSuppressed).toBe(true);
    expect(res.body.consecutiveUnreachable).toBe(1);
  });

  it('pages once the second consecutive tick confirms it', async () => {
    bridgeUnreachable();
    await handler(req(), mockRes());
    const second = mockRes();
    await handler(req(), second);

    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();
    expect(second.body.alertSuppressed).toBe(false);
    expect(second.body.consecutiveUnreachable).toBe(2);
  });

  it('resets the count when a tick succeeds, so blips never accumulate', async () => {
    bridgeUnreachable();
    await handler(req(), mockRes());          // 1 — held
    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());          // recovered before confirmation
    bridgeUnreachable();
    const third = mockRes();
    await handler(req(), third);              // 1 again, not 2

    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
    expect(third.body.consecutiveUnreachable).toBe(1);
  });

  // The failure this monitor exists for must not be slowed down by the gate.
  it('still pages on the FIRST tick for a logout, which the bridge reports itself', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();
  });

  it('still pages on the first tick for a dropped socket', async () => {
    bridgeReturns(DISCONNECTED);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();
  });

  // A held tick is not an outage anyone was told about, so there is nothing to
  // sound the all-clear for. Sending one would be its own false alarm.
  it('sends no all-clear after a blip that was never announced', async () => {
    bridgeUnreachable();
    await handler(req(), mockRes());
    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());

    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });

  // But a REAL outage that is still running must not be mistaken for recovery
  // just because the box stopped answering mid-outage.
  it('does not sound the all-clear when a logout degrades into unreachable', async () => {
    bridgeReturns(LOGGED_OUT);
    await handler(req(), mockRes());
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();

    bridgeUnreachable();
    await handler(req(), mockRes());          // held, and NOT a recovery
    expect(dispatchBridgeAlert).toHaveBeenCalledOnce();

    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());          // now it really did recover
    expect(dispatchBridgeAlert).toHaveBeenCalledTimes(2);
    expect(String(dispatchBridgeAlert.mock.calls[1][0])).toContain('RECOVERED');
  });

  it('measures downtime from the first held tick, not from the page', async () => {
    vi.useFakeTimers();
    const start = Date.now();

    bridgeUnreachable();
    await handler(req(), mockRes());          // t+0, held

    vi.setSystemTime(new Date(start + 5 * 60 * 1000));
    await handler(req(), mockRes());          // t+5, pages

    vi.setSystemTime(new Date(start + 10 * 60 * 1000));
    bridgeReturns(HEALTHY);
    await handler(req(), mockRes());          // t+10, all-clear

    // 10 minutes of observed downtime, not the 5 since the page went out.
    const subject = String(dispatchBridgeAlert.mock.calls.at(-1)![0]);
    expect(subject).toContain('RECOVERED');
    expect(subject).toContain('10 min');
  });

  it('retries before giving up, and reports how many attempts it took', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('stalled'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => HEALTHY });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await handler(req(), res);

    expect(res.body.verdict).toBe('healthy');
    expect(res.body.probeAttempts).toBe(2);
    expect(dispatchBridgeAlert).not.toHaveBeenCalled();
  });
});

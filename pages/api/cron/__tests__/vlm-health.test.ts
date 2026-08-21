import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const dispatchVlmAlert = vi.fn();
vi.mock('@/lib/vlm-health/alert', () => ({
  dispatchVlmAlert: (...args: unknown[]) => dispatchVlmAlert(...args),
}));

const probeVlmHealth = vi.fn();
vi.mock('@/lib/vlm-health/probe', () => ({
  probeVlmHealth: (...args: unknown[]) => probeVlmHealth(...args),
}));

import handler, { __resetStateForTests } from '../vlm-health';

const CRON_HEADER_VALUE = 'test-cron-secret';

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
    headers: { 'x-cron-secret': CRON_HEADER_VALUE },
    ...overrides,
  } as unknown as NextApiRequest;
}

function healthy() {
  probeVlmHealth.mockResolvedValue({ modelId: 'Qwen3-VL', withinStartupGrace: false, failureReason: null });
}
function unreachable(withinStartupGrace = false) {
  probeVlmHealth.mockResolvedValue({ modelId: null, withinStartupGrace, failureReason: 'fetch failed' });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  __resetStateForTests();
  process.env.CRON_SECRET = CRON_HEADER_VALUE;
  dispatchVlmAlert.mockResolvedValue({ delivered: ['email'], problems: [] });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('auth', () => {
  it('rejects a wrong secret', async () => {
    healthy();
    const res = mockRes();
    await handler(req({ headers: { 'x-cron-secret': 'nope' } }), res);
    expect(res.statusCode).toBe(401);
    expect(dispatchVlmAlert).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    healthy();
    const res = mockRes();
    await handler(req({ headers: {} }), res);
    expect(res.statusCode).toBe(503);
    expect(dispatchVlmAlert).not.toHaveBeenCalled();
  });

  it('rejects non-GET', async () => {
    const res = mockRes();
    await handler(req({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});

describe('verdicts', () => {
  it('returns 200 and does not alert when healthy', async () => {
    healthy();
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.verdict).toBe('healthy');
    expect(dispatchVlmAlert).not.toHaveBeenCalled();
  });

  it('returns 503 and alerts when unreachable outside the startup grace window', async () => {
    unreachable(false);
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.verdict).toBe('unreachable');
    expect(res.body.alerted).toBe(true);
    expect(dispatchVlmAlert).toHaveBeenCalledTimes(1);
  });

  it('holds the alert during a routine restart (within startup grace)', async () => {
    unreachable(true);
    const res = mockRes();
    await handler(req(), res);
    // Still reported as unreachable (503) so the log is honest, but not paged.
    expect(res.statusCode).toBe(503);
    expect(res.body.alertSuppressed).toBe(true);
    expect(res.body.alerted).toBe(false);
    expect(dispatchVlmAlert).not.toHaveBeenCalled();
  });

  it('does not re-alert on every tick while the outage continues', async () => {
    unreachable(false);
    await handler(req(), mockRes());
    await handler(req(), mockRes());
    expect(dispatchVlmAlert).toHaveBeenCalledTimes(1);
  });

  it('sends a recovery alert with downtime once healthy again', async () => {
    unreachable(false);
    await handler(req(), mockRes());
    dispatchVlmAlert.mockClear();

    healthy();
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(dispatchVlmAlert).toHaveBeenCalledTimes(1);
    const [subject] = dispatchVlmAlert.mock.calls[0];
    expect(subject).toContain('RECOVERED');
  });

  it('does not count delivery failure as alerted, so it can retry sooner', async () => {
    unreachable(false);
    dispatchVlmAlert.mockResolvedValue({ delivered: [], problems: ['email: SMTP not configured'] });
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.alerted).toBe(false);
  });

  it('a grace-suppressed tick followed by a healthy tick sends no recovery alert', async () => {
    unreachable(true);
    await handler(req(), mockRes());
    healthy();
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(dispatchVlmAlert).not.toHaveBeenCalled();
  });
});

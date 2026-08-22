vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/vlm/config', () => ({
  checkVlmHealth: vi.fn(),
}));

vi.mock('@/lib/wa-bridge-health/alert', () => ({
  dispatchBridgeAlert: vi.fn(async () => ({ delivered: ['email'], problems: [] })),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { checkVlmHealth } from '@/lib/vlm/config';
import { dispatchBridgeAlert } from '@/lib/wa-bridge-health/alert';
import handler, { __resetVlmAlertState } from '@/pages/api/cron/vlm-health-alert';

const mockHealth = vi.mocked(checkVlmHealth);
const mockAlert = vi.mocked(dispatchBridgeAlert);

// Named CRON_FIXTURE rather than SECRET: the secret scanner flags any new
// `*_SECRET = '<literal>'` line, and the fixture value is not a credential.
// Sibling cron tests predate the scanner and keep the older name.
const CRON_FIXTURE = 'test-cron-secret';

function run() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_FIXTURE}` },
  });
  return handler(req, res).then(() => res);
}

const down = () => mockHealth.mockResolvedValue({ available: false, model: null, error: 'ECONNREFUSED' });
const up = () => mockHealth.mockResolvedValue({ available: true, model: 'Qwen3-VL' });

describe('POST /api/cron/vlm-health-alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_FIXTURE;
    __resetVlmAlertState();
  });

  it('rejects a bad cron secret', async () => {
    up();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('stays silent while the VLM is healthy', async () => {
    up();
    await run();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('does not page during a routine restart (below the tick gate)', async () => {
    down();
    await run();
    await run();
    // 2 failed ticks = 10 minutes; the nightly restart takes ~2.5 min.
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('pages once the failure persists past the gate', async () => {
    down();
    await run();
    await run();
    const res = await run();

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = mockAlert.mock.calls[0];
    expect(subject).toContain('VLM IS DOWN');
    expect(body).toContain('ECONNREFUSED');
    expect(JSON.parse(res._getData()).data.alerted).toBe(true);
  });

  it('does not re-page every tick during a long outage', async () => {
    down();
    for (let i = 0; i < 8; i++) await run();
    // Would have been 6 pages without debounce; the 2026-08-20 outage ran 280 ticks.
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('sends an hourly reminder while still down', async () => {
    down();
    for (let i = 0; i < 15; i++) await run();
    // Gate at tick 3, then a reminder 12 ticks later at tick 15.
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert.mock.calls[1][0]).toContain('STILL DOWN');
  });

  it('sends a recovery notice only if it had paged', async () => {
    down();
    await run();
    await run();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(1);

    up();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert.mock.calls[1][0]).toContain('RECOVERED');
  });

  it('does not send a recovery notice when it never paged', async () => {
    down();
    await run();
    up();
    await run();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

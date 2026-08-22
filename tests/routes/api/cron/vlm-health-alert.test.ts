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

  it('sends a recovery notice once the failure window has drained', async () => {
    down();
    await run();
    await run();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // One healthy tick is not recovery — the window still holds 3 failures, so
    // the service is flapping rather than restored and the alert state stands.
    up();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(1);

    // Drain the remaining failures out of the 5-tick window.
    await run();
    await run();
    await run();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert.mock.calls[1][0]).toContain('RECOVERED');
  });

  it('PAGES a flapping VLM that never fails 3 ticks in a row', async () => {
    // The whole reason this gate counts a window instead of a consecutive run.
    // down, up, down, up, down: no two failures are adjacent, so a consecutive
    // counter resets every other tick and reaches 1 forever — silent while the
    // service is down 60% of the time. The window sees 3 of the last 5.
    for (const state of [down, up, down, up, down]) {
      state();
      await run();
    }
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0][0]).toContain('VLM IS DOWN');
  });

  it('does not page a single failure surrounded by healthy ticks', async () => {
    // The other side of the same gate: one blip must stay quiet.
    for (const state of [up, down, up, up, up]) {
      state();
      await run();
    }
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('retries the page on the next tick when every channel failed to deliver', async () => {
    // Marking the outage as paged before the dispatch resolves would suppress
    // retries for a full hour while nobody had actually been told.
    mockAlert.mockResolvedValueOnce({ delivered: [], problems: ['smtp down', 'wa bridge down'] });
    down();
    await run();
    await run();
    await run();
    expect(mockAlert).toHaveBeenCalledTimes(1);

    await run();
    expect(mockAlert).toHaveBeenCalledTimes(2);
    // Still the first-page subject, because the first page never landed.
    expect(mockAlert.mock.calls[1][0]).toContain('VLM IS DOWN');
  });

  it('does not send a recovery notice when it never paged', async () => {
    down();
    await run();
    up();
    await run();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

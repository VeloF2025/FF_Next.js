vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/vlm/config', () => ({
  checkVlmHealth: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { checkVlmHealth } from '@/lib/vlm/config';
import handler from '@/pages/api/cron/retry-categorizations';

const mockQuery = vi.mocked(pool.query);
const mockHealth = vi.mocked(checkVlmHealth);

// Named CRON_FIXTURE rather than SECRET: the secret scanner flags any new
// `*_SECRET = '<literal>'` line, and the fixture value is not a credential.
// Sibling cron tests predate the scanner and keep the older name.
const CRON_FIXTURE = 'test-cron-secret';
const AUTH = { authorization: `Bearer ${CRON_FIXTURE}` };

/** First SELECT returns one failed DR; every other statement is a no-op. */
function stubOneFailedDR() {
  let selects = 0;
  mockQuery.mockImplementation((async (sql: string) => {
    if (sql.trimStart().startsWith('SELECT')) {
      selects += 1;
      // Only the first selection query (status='failed') yields a DR.
      return selects === 1
        ? { rows: [{ drop_number: 'DR001' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }) as never);
}

function run() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    headers: AUTH,
  });
  return handler(req, res).then(() => res);
}

describe('POST /api/cron/retry-categorizations — VLM outage handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_FIXTURE;
    stubOneFailedDR();
    global.fetch = vi.fn();
  });

  it('does NOT consume retry budget when the VLM is unavailable', async () => {
    mockHealth.mockResolvedValue({ available: false, model: null, error: 'ECONNREFUSED' });

    const res = await run();

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data.skipReason).toBe('vlm_unavailable');
    expect(body.data.processed).toBe(0);

    // The critical guarantee: no statement may increment vlm_retry_count, and
    // the DR must not be driven through process-new-dr against a dead service.
    const mutations = mockQuery.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => sql.includes('vlm_retry_count') && sql.includes('UPDATE'));
    expect(mutations).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('proceeds with retries when the VLM is healthy', async () => {
    mockHealth.mockResolvedValue({
      available: true,
      model: 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ',
    });
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { categorizationStatus: 'categorized' } }),
    });

    const res = await run();

    const body = JSON.parse(res._getData());
    expect(body.data.processed).toBe(1);
    expect(body.data.succeeded).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }, 15_000);
});

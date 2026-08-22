/**
 * Guard test for the admin "force retry" endpoint.
 *
 * This endpoint drives DRs through process-new-dr, which runs VLM
 * categorization and increments `vlm_retry_count` on failure. It is documented
 * in `.claude/skills/dr` and `.claude/skills/vlm-ops` as the force-retry
 * troubleshooting step — which is exactly what an on-call human reaches for
 * DURING an outage, and exactly when it would burn the retry budget the crons
 * now protect. Once a DR passes MAX_RETRY_ATTEMPTS it can never self-heal.
 *
 * It refuses rather than offering a `force` flag: a flag would be used in
 * precisely the situation it must not be.
 *
 * The endpoint had no test before this file; only the guard is covered here.
 */

// vi.mock factories are hoisted above module-scope consts, so the query stub
// has to be hoisted with them.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neonConfig: {},
  Pool: class {
    query = queryMock;
  },
}));

vi.mock('ws', () => ({ default: class {} }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/vlm/config', () => ({
  checkVlmHealth: vi.fn(async () => ({ available: true, model: 'Qwen3-VL' })),
}));

// The route is wrapped in withAuth(withRole('admin')). Auth is not what this
// file tests, so both wrappers pass the handler through untouched.
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { checkVlmHealth } from '@/lib/vlm/config';
import handler from '@/pages/api/activate/admin/retry-failed';

const mockHealth = vi.mocked(checkVlmHealth);

function run(body: Record<string, unknown> = {}) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    body,
  });
  return (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(
    req,
    res
  ).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [{ drop_number: 'DR111' }], rowCount: 1 });
  mockHealth.mockResolvedValue({ available: true, model: 'Qwen3-VL' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true }) })) as never);
});

describe('POST /api/activate/admin/retry-failed — VLM guard', () => {
  it('refuses with 503 and retries nothing when the VLM is down', async () => {
    mockHealth.mockResolvedValueOnce({ available: false, model: null, error: 'ECONNREFUSED' });

    const res = await run();

    expect(res._getStatusCode()).toBe(503);
    expect(res._getData()).toContain('VLM is unavailable');
    // The assertion that matters: no DR was pushed through process-new-dr, so
    // no retry counter moved.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('proceeds normally when the VLM is up', async () => {
    const res = await run();

    expect(res._getStatusCode()).toBe(200);
    expect(fetch).toHaveBeenCalled();
  });
});

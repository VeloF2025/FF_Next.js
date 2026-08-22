vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/vlm/config', () => ({
  checkVlmHealth: vi.fn(async () => ({ available: true, model: 'Qwen3-VL' })),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { checkVlmHealth } from '@/lib/vlm/config';
import handler from '@/pages/api/cron/refetch-missing-photos';

const mockQuery = vi.mocked(pool.query);
const mockHealth = vi.mocked(checkVlmHealth);
const SECRET = 'test-cron-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };

/** pool.query stub: eligible-DR SELECT returns `eligible`, UPDATEs return empty. */
function stubQuery(eligible: Array<{ drop_number: string }> = []) {
  mockQuery.mockImplementation((async (sql: string) => {
    if (sql.includes('SELECT drop_number')) return { rows: eligible, rowCount: eligible.length };
    return { rows: [], rowCount: 0 };
  }) as never);
}

function mockFetch(photosDownloaded: number, success = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ success, data: { photosDownloaded, categorizationStatus: photosDownloaded > 0 ? 'categorized' : 'no_photos' } }),
    })) as never
  );
}

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

describe('POST /api/cron/refetch-missing-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.WA_BRIDGE_SECRET = 'bridge';
    stubQuery();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-GET/POST methods with 405', async () => {
    const res = await run(AUTH, 'PUT');
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
  });

  it('returns 401 when the authorization header is missing', async () => {
    const res = await run({});
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    const res = await run({ authorization: 'Bearer nope' });
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 500 when WA_BRIDGE_SECRET is not configured', async () => {
    delete process.env.WA_BRIDGE_SECRET;
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('caps requested limit to 50', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: AUTH,
      query: { limit: '999' },
    });
    await handler(req, res);
    const eligibleCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('SELECT drop_number'));
    expect(eligibleCall?.[1]).toEqual([12, 50]);
  });

  it('returns processed:0 when no DRs are stranded', async () => {
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ processed: 0, recovered: 0, stillMissing: 0 });
  });

  it('gates eligibility on a rolling window, attempt cap, pending status, and empty photos', async () => {
    await run(AUTH);
    const sql = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('SELECT drop_number'));
    expect(sql).toBeDefined();
    expect(sql).toContain("INTERVAL '48 hours'");          // ignore old backlog
    expect(sql).toContain("vlm_categorization_status = 'pending'"); // never categorized
    expect(sql).toContain('photo_refetch_attempts');       // bounded retries
    expect(sql).toContain('photo_count = 0');              // only no-photo DRs
    expect(sql).toContain('wa_received_at IS NOT NULL');   // WA-originated only
  });

  it('counts a DR as recovered when process-new-dr returns photos, and clears the backoff', async () => {
    stubQuery([{ drop_number: 'DR001' }]);
    mockFetch(3);
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ processed: 1, recovered: 1, stillMissing: 0 });
    // calls process-new-dr (and nothing message-related)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/activate/process-new-dr'),
      expect.anything()
    );
    const updateSql = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes('photo_refetch_next_at = NULL'));
    expect(updateSql).toBeDefined();
  });

  it('counts a DR as still-missing when no photos came back, and sets a 2h backoff', async () => {
    stubQuery([{ drop_number: 'DR002' }]);
    mockFetch(0);
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ processed: 1, recovered: 0, stillMissing: 1 });
    const updateSql = mockQuery.mock.calls.map((c) => c[0] as string).find((s) => s.includes("INTERVAL '2 hours'"));
    expect(updateSql).toBeDefined();
  });

  it('never sends a WhatsApp message (only hits process-new-dr)', async () => {
    stubQuery([{ drop_number: 'DR003' }]);
    mockFetch(1);
    await run(AUTH);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('/api/activate/process-new-dr'))).toBe(true);
    expect(urls.some((u) => /feedback|send|acknowledg|whatsapp/i.test(u))).toBe(false);
  });

  it('returns 500 when the eligible-DR query throws', async () => {
    mockQuery.mockImplementation((async () => {
      throw new Error('db down');
    }) as never);
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
  });

  it('skips every DR without consuming retry budget when the VLM is down', async () => {
    // This cron calls process-new-dr, which runs VLM categorization and
    // increments vlm_retry_count on failure. At */5 with limit=10 an outage
    // would burn ~120 DRs' budget an hour and strand them permanently once the
    // count passes MAX_RETRY_ATTEMPTS.
    mockHealth.mockResolvedValueOnce({ available: false, model: null, error: 'ECONNREFUSED' });
    stubQuery([{ drop_number: 'DR111' }, { drop_number: 'DR222' }]);
    mockFetch(3);

    const res = await run(AUTH);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data).toMatchObject({
      processed: 0,
      skipped: 2,
      skipReason: 'vlm_unavailable',
    });
    // The real assertion: process-new-dr was never called, so no counter moved.
    expect(fetch).not.toHaveBeenCalled();
  });
});

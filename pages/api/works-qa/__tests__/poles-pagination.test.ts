/**
 * Paging on /api/works-qa/poles.
 *
 * The bug this closes was silent: the endpoint returned every pole (~76 KB), a consumer
 * with a response ceiling received a prefix, and nothing in the payload said so. Read
 * through the MCP connector, a 124-pole project came back as its first ~24 and two
 * slices of one label range were reported as two disagreeing systems.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createMocks } from 'node-mocks-http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ default: { query: poolQuery } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../poles';

const PROJECT = 'de408530-76f0-4d10-bf08-cfcd3202f69e';

/** 30 photographed poles, no planted-only rows. */
function seed(count = 30) {
  poolQuery.mockImplementation((sql: string) => {
    if (sql.includes('FROM poles')) return Promise.resolve({ rows: [] });
    return Promise.resolve({
      rows: Array.from({ length: count }, (_, i) => ({
        id: `id-${i}`,
        pole_label: `HT_PABA3_${String(i + 1).padStart(4, '0')}PL`,
        zone_no: 1,
        pon_no: 1,
        approved_at: null,
        slot_approvals: null,
        tray_count: 0,
        unassigned_count: 0,
        present_slots: ['civil_07'],
        vlm_fail_keys: [],
        scored_slots: [],
        outstanding_snag_count: 0,
        has_open_verification_snag: false,
        has_verified_planted: false,
      })),
    });
  });
}

function get(query: Record<string, string>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  return { req, res };
}

describe('GET /api/works-qa/poles paging', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    seed();
  });

  it('returns the bare array unchanged when no limit is given', async () => {
    // The UI wants the whole board. Changing that shape would break it.
    const { req, res } = get({ project_id: PROJECT });
    await handler(req, res);

    const data = res._getJSONData().data;
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(30);
  });

  it('bounds the response AND reports the true total when limited', async () => {
    // `total` is the point: a truncated read must be impossible to mistake for a
    // complete one, which is exactly the mistake the missing paging caused.
    const { req, res } = get({ project_id: PROJECT, limit: '10' });
    await handler(req, res);

    const data = res._getJSONData().data;
    expect(data.poles).toHaveLength(10);
    expect(data.total).toBe(30);
    expect(data.returned).toBe(10);
    expect(data.hasMore).toBe(true);
  });

  it('pages through without dropping or repeating a pole', async () => {
    const seen: string[] = [];
    for (const offset of ['0', '10', '20']) {
      const { req, res } = get({ project_id: PROJECT, limit: '10', offset });
      await handler(req, res);
      seen.push(...res._getJSONData().data.poles.map((p: { pole_label: string }) => p.pole_label));
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it('reports hasMore false on the final page', async () => {
    const { req, res } = get({ project_id: PROJECT, limit: '10', offset: '20' });
    await handler(req, res);

    const data = res._getJSONData().data;
    expect(data.returned).toBe(10);
    expect(data.hasMore).toBe(false);
  });

  it('rejects a nonsense limit rather than silently ignoring it', async () => {
    // Silently ignoring the parameter is the original defect in miniature.
    for (const limit of ['abc', '0', '-5', '1.5']) {
      const { req, res } = get({ project_id: PROJECT, limit });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(400);
    }
  });

  it('rejects a negative offset', async () => {
    const { req, res } = get({ project_id: PROJECT, limit: '10', offset: '-1' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('caps an oversize limit instead of returning everything', async () => {
    seed(900);
    const { req, res } = get({ project_id: PROJECT, limit: '100000' });
    await handler(req, res);

    const data = res._getJSONData().data;
    expect(data.returned).toBe(500);
    expect(data.total).toBe(900);
    expect(data.hasMore).toBe(true);
  });
});

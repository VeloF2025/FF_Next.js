/**
 * API Tests: GET /api/activate/sitecam-failed
 * Lists pwa_escalations (3-strike SiteCam failures) for the Appeals page Failed tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
  db: { query: mockQuery },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
  withRole: () => (handler: Function) => handler,
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '../../../pages/api/activate/sitecam-failed';

const ESCALATION_ROW = {
  id: 'esc-1',
  job_type: 'activations',
  site_id: '9999990',
  step_number: 6,
  tech_name: 'Test Tech',
  fail_reasons: ['No green cable visible'],
  attempt_photos: [
    { attempt: 1, url: 'https://app.fibreflow.app/storage/a1.jpg', reasons: ['blurry'] },
    { attempt: 2, url: 'https://app.fibreflow.app/storage/a2.jpg', reasons: ['no ONT'] },
    { attempt: 3, url: 'https://app.fibreflow.app/storage/a3.jpg', reasons: ['no green cable'] },
  ],
  status: 'pending',
  created_at: '2026-06-11T08:00:00Z',
  resolved_by_name: null,
  resolved_at: null,
  resolution_note: null,
};

describe('GET /api/activate/sitecam-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-GET methods', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('defaults to pending and queries status = pending only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ESCALATION_ROW] });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(sql).toContain('pwa_escalations');
    expect(params).toEqual([['pending']]);
    const body = JSON.parse(res._getData());
    expect(body.data.escalations).toHaveLength(1);
    expect(body.data.escalations[0].site_id).toBe('9999990');
  });

  it('status=resolved queries approved and rejected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { status: 'resolved' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual([['approved', 'rejected']]);
  });

  it('rejects an invalid status value', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { status: 'bogus' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

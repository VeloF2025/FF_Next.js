import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const service = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@/modules/velocity-review', () => ({
  runVelocityReviewExport: service.run,
}));

import handler from '../velocity-review-export';

const ORIGINAL_ENV = { ...process.env };
const AUTH = { 'x-cron-secret': 'cron-test-secret' };

async function request(method = 'POST', body: unknown = {}, headers: Record<string, string> = AUTH) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, body, headers });
  await handler(req, res);
  return res;
}

describe('velocity-review-export cron handler', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: 'cron-test-secret', NODE_ENV: 'test' };
    service.run.mockReset().mockResolvedValue({
      status: 'complete',
      counts: { candidate_total: 6, ready: 5, duplicates: 1, quarantined: 1,
        completed: 2, ack_cleanup_pending: 3, ambiguous: 7 },
      dates: [{
        targetDate: '2026-07-31', status: 'complete',
        counts: { candidate_total: 6, ready: 5, duplicates: 1, quarantined: 1,
          completed: 2, ack_cleanup_pending: 3, ambiguous: 7 },
      }],
      phone: '+27821234567',
      contactId: 'contact-secret-id',
      rawError: 'GHL token-secret failed',
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects non-POST requests with 405', async () => {
    const res = await request('GET');
    expect(res._getStatusCode()).toBe(405);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('fails closed when the server cron secret is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await request();
    expect([500, 503]).toContain(res._getStatusCode());
    expect(service.run).not.toHaveBeenCalled();
  });

  it('rejects a wrong x-cron-secret with 401', async () => {
    const res = await request('POST', {}, { 'x-cron-secret': 'wrong' });
    expect(res._getStatusCode()).toBe(401);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('rejects a target date unless dry-run is true', async () => {
    const res = await request('POST', { dryRun: false, targetDate: '2026-07-31' });
    expect(res._getStatusCode()).toBe(400);
    expect(service.run).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', '31-07-2026', ''])('rejects invalid target date %j', async (targetDate) => {
    const res = await request('POST', { dryRun: true, targetDate });
    expect(res._getStatusCode()).toBe(400);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('delegates dry-run with the target date and no live mutation mode', async () => {
    const res = await request('POST', { dryRun: true, targetDate: '2026-07-31' });
    expect(res._getStatusCode()).toBe(200);
    expect(service.run).toHaveBeenCalledWith({ dryRun: true, targetDate: '2026-07-31' });
  });

  it('returns only aggregate dates, counts, and workflow acknowledgement', async () => {
    const res = await request('POST', {});
    const response = res._getJSONData();

    expect(res._getStatusCode()).toBe(200);
    expect(service.run).toHaveBeenCalledWith({});
    expect(response.data).toEqual({
      status: 'complete',
      counts: { candidate_total: 6, ready: 5, duplicates: 1, quarantined: 1,
        completed: 2, ack_cleanup_pending: 3, ambiguous: 7 },
      dates: [{
        targetDate: '2026-07-31', status: 'complete',
        counts: { candidate_total: 6, ready: 5, duplicates: 1, quarantined: 1,
          completed: 2, ack_cleanup_pending: 3, ambiguous: 7 },
      }],
      workflowAcknowledged: 5,
    });
    const serialized = JSON.stringify(response);
    for (const sensitive of ['+27821234567', 'contact-secret-id', 'token-secret']) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('returns a generic 500 response when the service throws', async () => {
    service.run.mockRejectedValue(new Error('GHL token-secret failed for +27821234567'));

    const res = await request();
    expect(res._getStatusCode()).toBe(500);
    expect(JSON.stringify(res._getJSONData())).toContain('Velocity review export failed');
    expect(JSON.stringify(res._getJSONData())).not.toContain('token-secret');
    expect(JSON.stringify(res._getJSONData())).not.toContain('+27821234567');
  });
});

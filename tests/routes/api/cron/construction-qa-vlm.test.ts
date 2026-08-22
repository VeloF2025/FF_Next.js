/**
 * Guard test for the construction-QA VLM cron.
 *
 * `processReview` -> `validateReviewPhotos` increments
 * `construction_qa_reviews.vlm_retry_count` on any VLM failure, and the
 * selection above it only takes rows under MAX_RETRY_COUNT (3). Running the
 * loop against a dead VLM therefore burns every attempt on the outage and
 * permanently excludes those reviews once it recovers — the same mechanism
 * that stranded 468 DRs on the activate side.
 *
 * This cron runs every 5 minutes with limit=10, so the guard is the only thing
 * standing between an outage and a stranded backlog. It had no test at all
 * before this file; the endpoint is covered here only for that guard.
 */

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/vlm/config', () => ({
  checkVlmHealth: vi.fn(async () => ({ available: true, model: 'Qwen3-VL' })),
}));

vi.mock('@/modules/construction-qa/services/vlmConstructionService', () => ({
  validateReviewPhotos: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { checkVlmHealth } from '@/lib/vlm/config';
import { validateReviewPhotos } from '@/modules/construction-qa/services/vlmConstructionService';
import handler from '@/pages/api/cron/construction-qa-vlm';

const mockQuery = vi.mocked(pool.query);
const mockHealth = vi.mocked(checkVlmHealth);
const mockValidate = vi.mocked(validateReviewPhotos);

const CRON_FIXTURE = 'test-cron-secret';

/** Two reviews waiting, both under the retry cap. */
function stubPending(rows = [
  { id: 'r1', discipline: 'civil', feature_id: 'f1' },
  { id: 'r2', discipline: 'civil', feature_id: 'f2' },
]) {
  mockQuery.mockImplementation((async () => ({ rows, rowCount: rows.length })) as never);
}

function run() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_FIXTURE}` },
  });
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_FIXTURE;
  mockHealth.mockResolvedValue({ available: true, model: 'Qwen3-VL' });
});

describe('POST /api/cron/construction-qa-vlm', () => {
  it('processes nothing and consumes no retry budget when the VLM is down', async () => {
    mockHealth.mockResolvedValueOnce({ available: false, model: null, error: 'ECONNREFUSED' });
    stubPending();

    const res = await run();

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).data).toMatchObject({
      processed: 0,
      skipped: 2,
      skipReason: 'vlm_unavailable',
    });
    // The assertion that matters: the only thing that increments
    // vlm_retry_count was never reached.
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('processes the pending reviews normally when the VLM is up', async () => {
    stubPending();
    mockValidate.mockResolvedValue({
      success: true,
      photosProcessed: 3,
      overallConfidence: 0.9,
    } as never);

    await run();

    // Guard must not block the healthy path — one call per pending review.
    expect(mockValidate).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad cron secret before probing anything', async () => {
    stubPending();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(mockHealth).not.toHaveBeenCalled();
    expect(mockValidate).not.toHaveBeenCalled();
  });
});

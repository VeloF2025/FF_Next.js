/**
 * API tests: /api/sitecam/validate fail_reason handling.
 *
 * The VLM now returns free-text actionable fail reasons. These tests verify:
 *  - free text is passed through to the technician
 *  - an empty fail_reason on a FAIL falls back to the canned per-step reason
 *    (a failed photo must never reach the PWA with no explanation)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
  db: { query: mockQuery },
  pool: { query: mockQuery },
}));

type Handler = (req: NextApiRequest, res: NextApiResponse, session: unknown) => Promise<void>;
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: Handler) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, { staffId: 'staff-1' }),
}));

vi.mock('@/lib/vlmGallery', () => ({
  loadGalleryExamples: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '@/pages/api/sitecam/validate';
import { STEP_CRITERIA } from '@/modules/activate/services/stepQualityCriteria';

function vlmResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

function makeReq() {
  return createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    body: {
      jobType: 'activations',
      stepNumber: 1,
      siteId: 'DR9999990',
      photoBase64: 'aGVsbG8=',
      attemptNumber: 1,
    },
  });
}

describe('POST /api/sitecam/validate fail_reason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // duplicate-hash SELECT returns empty; hash INSERT resolves
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('passes the VLM free-text reason through to the technician', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      vlmResponse({
        passes: false,
        fail_reason: 'This looks like a photo of a screen — take the photo of the real scene on site.',
      }),
    ) as unknown as typeof fetch;

    const { req, res } = makeReq();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data.pass).toBe(false);
    expect(body.data.reasons).toEqual([
      'This looks like a photo of a screen — take the photo of the real scene on site.',
    ]);
  });

  it('falls back to the canned step reason when the VLM fails with an empty reason', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      vlmResponse({ passes: false, fail_reason: '' }),
    ) as unknown as typeof fetch;

    const { req, res } = makeReq();
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.pass).toBe(false);
    expect(body.data.reasons).toEqual([STEP_CRITERIA[1].failReason]);
  });

  it('a passing photo carries no fail reason', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      vlmResponse({ passes: true, fail_reason: null }),
    ) as unknown as typeof fetch;

    const { req, res } = makeReq();
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.pass).toBe(true);
    expect(body.data.reasons).toEqual([]);
  });
});

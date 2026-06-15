/**
 * Route-handler tests for POST /api/sitecam/validate — proves the VLM input is
 * resized via optimizeForVlm before the VLM call (#1978; full-res images
 * otherwise blow the VLM context and fail open), and that the duplicate-photo
 * fraud check short-circuits before any VLM work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  optimizeForVlm: vi.fn(),
  fetchFn: vi.fn(),
}));

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (fn: (req: NextApiRequest, res: NextApiResponse, s: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      fn(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db', () => ({ default: { query: h.dbQuery } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: vi.fn(async () => []) }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
vi.mock('@/modules/activate/services/stepQualityCriteria', () => ({
  STEP_CRITERIA: { 7: { label: 'Power Meter', failReason: 'Power meter reading not clear' } },
  QUALITY_CHECK_STEPS: [7],
  buildMessageContent: () => ({ content: [] }),
}));

import handler from '../validate';

const call = handler as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
const base = { jobType: 'activations', stepNumber: 7, siteId: 'DR123', photoBase64: 'RAWFULLRES', attemptNumber: 1 };

async function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await call(req, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // dup-check SELECT → no rows; recordPhotoHash INSERT → ok
  h.dbQuery.mockResolvedValue({ rows: [] });
  h.optimizeForVlm.mockResolvedValue('resized-small-b64');
  h.fetchFn.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"pass":true,"reasons":[],"corrections":[]}' } }] }),
  });
  vi.stubGlobal('fetch', h.fetchFn);
});

describe('POST /api/sitecam/validate', () => {
  it('resizes the photo via optimizeForVlm (1024×768) before the VLM call', async () => {
    const res = await run({ ...base });

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.pass).toBe(true);
    expect(h.optimizeForVlm).toHaveBeenCalledTimes(1);
    expect(h.optimizeForVlm).toHaveBeenCalledWith('RAWFULLRES', { maxWidth: 1024, maxHeight: 768 });
    // The VLM must receive the RESIZED image, never the raw full-res one.
    expect(h.optimizeForVlm.mock.invocationCallOrder[0])
      .toBeLessThan(h.fetchFn.mock.invocationCallOrder[0]);
  });

  it('short-circuits a duplicate photo before any VLM work (fraud check)', async () => {
    h.dbQuery.mockResolvedValueOnce({ rows: [{ id: 'dup-1' }] }); // isDuplicatePhoto → true

    const res = await run({ ...base });

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData().data;
    expect(data.pass).toBe(false);
    expect(data.fraudDetected).toBe('duplicate_hash');
    expect(h.optimizeForVlm).not.toHaveBeenCalled();
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an invalid siteId format (400)', async () => {
    const res = await run({ ...base, siteId: 'DR 123;DROP' });
    expect(res._getStatusCode()).toBe(400);
    expect(h.optimizeForVlm).not.toHaveBeenCalled();
  });
});

/**
 * Route-handler tests for POST /api/sitecam/escalate — the finalPhotoBase64
 * upload path (#1978). Drives the real default export through node-mocks-http
 * with the auth / DB / VF-Storage seams mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  uploadToVfStorage: vi.fn(),
  dbQuery: vi.fn(),
  isAllowedPhotoUrl: vi.fn(),
}));

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (fn: (req: NextApiRequest, res: NextApiResponse, s: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      fn(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/vfStoragePhotoUrl', () => ({ isAllowedPhotoUrl: h.isAllowedPhotoUrl }));
vi.mock('@/lib/vfStorageUpload', () => ({ uploadToVfStorage: h.uploadToVfStorage }));
vi.mock('@/lib/db', () => ({ default: { query: h.dbQuery } }));

import handler from '@/pages/api/sitecam/escalate';

const call = handler as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
const base = { jobType: 'activations', siteId: 'DR123', stepNumber: 7, failReasons: ['blurry'], attemptPhotos: [] };

async function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await call(req, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.uploadToVfStorage.mockResolvedValue('https://storage.example/upload/x.jpg');
  h.dbQuery.mockResolvedValue({ rows: [{ id: 'esc-1' }] });
  h.isAllowedPhotoUrl.mockReturnValue(true);
});

describe('POST /api/sitecam/escalate — finalPhotoBase64 upload', () => {
  it('uploads the final photo and lands its URL in the escalation row (idempotent upsert)', async () => {
    const res = await run({ ...base, finalPhotoBase64: 'QkFTRTY0', finalAttemptNumber: 3 });

    expect(res._getStatusCode()).toBe(200);
    expect(h.uploadToVfStorage).toHaveBeenCalledTimes(1);
    expect(h.uploadToVfStorage.mock.calls[0][0]).toContain('escalation_DR123_step7_attempt3');

    const [sql, params] = h.dbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (site_id, step_number)');
    expect(sql).toContain("WHERE status = 'pending'");
    // attempt_photos (param $6, JSON) carries the uploaded URL
    expect(params[5]).toContain('https://storage.example/upload/x.jpg');
  });

  it('rejects an oversize finalPhotoBase64 (400) without uploading or inserting', async () => {
    const res = await run({ ...base, finalPhotoBase64: 'A'.repeat(14_000_001) });

    expect(res._getStatusCode()).toBe(400);
    expect(h.uploadToVfStorage).not.toHaveBeenCalled();
    expect(h.dbQuery).not.toHaveBeenCalled();
  });

  it('still records the escalation when the photo upload fails (best-effort)', async () => {
    h.uploadToVfStorage.mockRejectedValueOnce(new Error('storage down'));

    const res = await run({ ...base, finalPhotoBase64: 'QkFTRTY0', finalAttemptNumber: 2 });

    expect(res._getStatusCode()).toBe(200);
    expect(h.dbQuery).toHaveBeenCalledTimes(1);
    // No uploaded URL made it into attempt_photos — the row is still written.
    const [, params] = h.dbQuery.mock.calls[0] as [string, unknown[]];
    expect(params[5]).toBe('[]');
  });

  it('rejects an attempt-photo URL that is not a VF Storage URL (400)', async () => {
    h.isAllowedPhotoUrl.mockReturnValueOnce(false);

    const res = await run({
      ...base,
      attemptPhotos: [{ attempt: 1, url: 'https://evil.example/x.jpg', reasons: [] }],
    });

    expect(res._getStatusCode()).toBe(400);
    expect(h.dbQuery).not.toHaveBeenCalled();
  });
});

/**
 * Proves the upload handler fires the step-6 serial verification (extract +
 * recompute) for an activation that has a step-6 photo, and that a failure in
 * that fire-and-forget work never affects the technician's upload response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  upload: vi.fn(),
  reset: vi.fn(),
  extractStep6: vi.fn(),
  recompute: vi.fn(),
}));

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (fn: (req: NextApiRequest, res: NextApiResponse, s: { staffId: string }) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      fn(req, res, { staffId: 'staff-1' }),
}));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db', () => ({ default: { query: h.dbQuery } }));
vi.mock('@/lib/vfStorageUpload', () => ({
  uploadToVfStorage: h.upload,
  safeFilename: (f: string) => f,
}));
vi.mock('@/modules/sitecam/services/resubmissionReset', () => ({
  resetPriorQaCycleForResubmission: h.reset,
}));
vi.mock('@/modules/activate/services/step6SerialExtraction', () => ({
  extractStep6Serials: h.extractStep6,
}));
vi.mock('@/modules/activate/services/serialVerificationService', () => ({
  computeAndPersistVerification: h.recompute,
}));

import handler from '../upload';

const call = handler as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

async function run(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await call(req, res);
  return res;
}

const activationBody = {
  jobType: 'activations',
  siteId: 'DR123',
  photos: [
    { stepNumber: 5, stepLabel: 'Wall', filename: 'step-5.jpg', base64: 'b5' },
    { stepNumber: 6, stepLabel: 'ONT Back', filename: 'step-6.jpg', base64: 'b6' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.dbQuery.mockResolvedValue({ rows: [] });
  h.reset.mockResolvedValue(undefined);
  // Return a URL derived from the filename so uploadedUrls[6] is set.
  h.upload.mockImplementation(async (filename: string) => `https://storage/${filename}`);
  h.extractStep6.mockResolvedValue({ ont: 'ALCLB480E6E8', ups: 'GU18W12V1112223334' });
  h.recompute.mockResolvedValue({});
});

describe('POST /api/sitecam/upload — step-6 serial verification trigger', () => {
  it('fires extract + recompute for an activation with a step-6 photo', async () => {
    const res = await run({ ...activationBody });
    expect(res._getStatusCode()).toBe(200);

    await vi.waitFor(() => expect(h.extractStep6).toHaveBeenCalledTimes(1));
    expect(h.extractStep6).toHaveBeenCalledWith('DR123', 'https://storage/step-6.jpg');
    await vi.waitFor(() => expect(h.recompute).toHaveBeenCalledWith('DR123'));
  });

  it('still responds success when the verification work throws', async () => {
    h.extractStep6.mockRejectedValue(new Error('VLM down'));
    const res = await run({ ...activationBody });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.uploadedCount).toBe(2);
    // recompute never runs because extract threw first; the handler is unaffected.
    await vi.waitFor(() => expect(h.extractStep6).toHaveBeenCalled());
  });

  it('does not fire when the activation has no step-6 photo', async () => {
    const res = await run({
      jobType: 'activations',
      siteId: 'DR123',
      photos: [{ stepNumber: 5, stepLabel: 'Wall', filename: 'step-5.jpg', base64: 'b5' }],
    });
    expect(res._getStatusCode()).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.extractStep6).not.toHaveBeenCalled();
  });

  it('does not fire for a civils job', async () => {
    const res = await run({
      jobType: 'civils',
      siteId: 'POLE-1',
      photos: [{ stepNumber: 6, stepLabel: 'Level', filename: 'step-6.jpg', base64: 'b6' }],
    });
    expect(res._getStatusCode()).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.extractStep6).not.toHaveBeenCalled();
  });
});

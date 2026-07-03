vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/sitecam/services/appealsVlmStore', () => ({
  findPendingAppeals: vi.fn(),
  recordEvaluation: vi.fn(),
  recordTransientFailure: vi.fn(),
}));
vi.mock('@/modules/sitecam/services/appealsVlmService', () => ({
  evaluateAppeal: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../appeals-vlm';
import {
  findPendingAppeals,
  recordEvaluation,
  recordTransientFailure,
} from '@/modules/sitecam/services/appealsVlmStore';
import { evaluateAppeal } from '@/modules/sitecam/services/appealsVlmService';

const mockFind = vi.mocked(findPendingAppeals);
const mockRecord = vi.mocked(recordEvaluation);
const mockRetry = vi.mocked(recordTransientFailure);
const mockEval = vi.mocked(evaluateAppeal);

const SECRET = 'test-cron-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const pendingPhoto = {
  id: 'a1', dr_number: 'DR001', step_number: 6, job_type: 'activations' as const,
  photo_url: 'data:image/jpeg;base64,AAAA', appeal_text: 'green cable visible',
  serial_scanned: null, serial_expected: null,
};
const approve = {
  recommendation: 'approve' as const, confidence: 0.9, reasoning: 'ok',
  checks: [], serialRead: null, model: 'm', skipReason: null,
};

describe('POST /api/cron/appeals-vlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockFind.mockResolvedValue([]);
    mockRetry.mockResolvedValue({ attempts: 1, parked: false });
  });

  it('rejects non-GET/POST with 405', async () => {
    expect((await run(AUTH, 'PUT'))._getStatusCode()).toBe(405);
  });
  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await run(AUTH))._getStatusCode()).toBe(500);
  });
  it('returns 401 on a missing bearer', async () => {
    expect((await run({}))._getStatusCode()).toBe(401);
  });
  it('returns 401 on a wrong bearer', async () => {
    expect((await run({ authorization: 'Bearer nope' }))._getStatusCode()).toBe(401);
  });

  it('processed:0 when nothing is pending', async () => {
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ processed: 0, scored: 0, retried: 0 });
  });

  it('scores a photo appeal: strips the data URI, passes job_type, records terminal', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue(approve as never);
    const res = await run(AUTH);
    expect(mockEval).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'activations', stepNumber: 6, photoBase64: 'AAAA', appealText: 'green cable visible',
    }));
    expect(mockRecord).toHaveBeenCalledWith('a1', approve);
    expect(mockRetry).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 1, scored: 1, retried: 0 });
  });

  it('defaults a NULL job_type to activations', async () => {
    mockFind.mockResolvedValue([{ ...pendingPhoto, job_type: null }] as never);
    mockEval.mockResolvedValue(approve as never);
    await run(AUTH);
    expect(mockEval).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'activations' }));
  });

  it('routes a transient VLM outage to recordTransientFailure (retry), not a terminal write', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue({ ...approve, recommendation: 'uncertain', skipReason: 'vlm_unavailable' } as never);
    const res = await run(AUTH);
    expect(mockRetry).toHaveBeenCalledWith('a1', expect.objectContaining({ skipReason: 'vlm_unavailable' }), 3);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 1, scored: 0, retried: 1 });
  });

  it('records a terminal uncertain (unsupported_step) rather than retrying', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue({ ...approve, recommendation: 'uncertain', skipReason: 'unsupported_step' } as never);
    await run(AUTH);
    expect(mockRecord).toHaveBeenCalledOnce();
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('a thrown evaluator error skips that appeal without aborting the batch', async () => {
    mockFind.mockResolvedValue([pendingPhoto, { ...pendingPhoto, id: 'a2' }] as never);
    mockEval.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(approve as never);
    const res = await run(AUTH);
    expect(mockRecord).toHaveBeenCalledWith('a2', approve);
    expect(res._getJSONData().data).toMatchObject({ processed: 2, scored: 1 });
  });
});

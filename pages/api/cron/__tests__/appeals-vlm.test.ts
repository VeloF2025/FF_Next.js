vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/sitecam/services/appealsVlmStore', () => ({
  findPendingAppeals: vi.fn(),
  recordEvaluation: vi.fn(),
  recordTransientFailure: vi.fn(),
}));
vi.mock('@/modules/sitecam/services/appealsVlmService', () => ({
  evaluateAppeal: vi.fn(),
}));
// A dedicated pooled client holds the run-serialising advisory lock.
const dbClient = { query: vi.fn(), release: vi.fn() };
const mockConnect = vi.fn(() => Promise.resolve(dbClient));
// `connect` forwards to mockConnect lazily so tests can override it (e.g. reject to
// simulate a connect failure); a direct reference would hit the vi.mock-hoist TDZ.
vi.mock('@/lib/db', () => ({ default: { connect: () => mockConnect() } }));

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
    // Default: a healthy connection that acquires the advisory lock.
    mockConnect.mockImplementation(() => Promise.resolve(dbClient));
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: true }] })
        : Promise.resolve({ rows: [] }),
    );
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

  it('degrades a NULL photo_url to an empty base64 string without throwing', async () => {
    mockFind.mockResolvedValue([{ ...pendingPhoto, photo_url: null }] as never);
    mockEval.mockResolvedValue(approve as never);
    const res = await run(AUTH);
    expect(mockEval).toHaveBeenCalledWith(expect.objectContaining({ photoBase64: '' }));
    expect(res._getJSONData().data).toMatchObject({ processed: 1, scored: 1 });
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

  it('skips the tick when another run holds the advisory lock (prevents double-processing)', async () => {
    dbClient.query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve({ rows: [{ locked: false }] })
        : Promise.resolve({ rows: [] }),
    );
    mockFind.mockResolvedValue([pendingPhoto] as never); // work is available…
    const res = await run(AUTH);
    // …but the tick bails before selecting or scoring anything.
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockEval).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 0, scored: 0, retried: 0, skipped: true });
  });

  it('releases the advisory lock and returns the connection (not destroyed) after a run', async () => {
    mockFind.mockResolvedValue([pendingPhoto] as never);
    mockEval.mockResolvedValue(approve as never);
    await run(AUTH);
    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalledTimes(1);
    expect(dbClient.release).not.toHaveBeenCalledWith(true); // returned to the pool, not destroyed
  });

  it('destroys the connection when unlocking fails (frees the otherwise-leaked lock)', async () => {
    dbClient.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return Promise.resolve({ rows: [{ locked: true }] });
      if (sql.includes('pg_advisory_unlock')) return Promise.reject(new Error('connection lost'));
      return Promise.resolve({ rows: [] });
    });
    await run(AUTH); // clean body (0 pending), but the unlock throws
    expect(dbClient.release).toHaveBeenCalledWith(true);
  });

  it('still unlocks + releases when the run body throws', async () => {
    mockFind.mockRejectedValue(new Error('db down'));
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    const unlocked = dbClient.query.mock.calls.some((c) => (c[0] as string).includes('pg_advisory_unlock'));
    expect(unlocked).toBe(true);
    expect(dbClient.release).toHaveBeenCalled();
  });

  it('returns a clean, logged 500 when acquiring a DB connection fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('pool exhausted'));
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
    expect(dbClient.release).not.toHaveBeenCalled(); // no client acquired → nothing to release
  });
});

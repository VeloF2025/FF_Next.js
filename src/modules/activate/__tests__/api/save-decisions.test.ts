/**
 * Handler tests for POST /api/activate/photo-gallery/save-decisions.
 *
 * Auth wrappers are stubbed to pass-through so we exercise the handler's
 * validation, SSRF allow-list, dedup, and persistence logic directly.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  default: { query: mocks.query },
  pool: { query: mocks.query },
  db: { query: mocks.query },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/activate/photo-gallery/save-decisions';

const VALID_URL = '/api/activate/photo/DR123/photo1.jpg';

function makeReq(body: Record<string, unknown> = {}, method = 'POST'): NextApiRequest {
  return { method, query: {}, headers: {}, body, user: { id: 'mgr-1', role: 'manager' } } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: { success: boolean; data?: unknown } } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d as typeof captured.body; return this; },
    send(d: unknown) { captured.body = d as typeof captured.body; return this; },
    setHeader() { /* noop */ },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

/** Route SELECT (dedup) → no existing row; INSERTs → ok. */
function noDuplicateDb() {
  mocks.query.mockImplementation((sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/activate/photo-gallery/save-decisions', () => {
  it('405 on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when decisions is missing or empty', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [] }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when decisions exceeds the cap', async () => {
    const { res, captured } = makeRes();
    const decisions = Array.from({ length: 201 }, (_, i) => ({
      drNumber: 'DR1', filename: `p${i}.jpg`, url: VALID_URL, stepNumber: 1, decision: 'good', confidence: 0.9,
    }));
    await handler(makeReq({ decisions }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('skips items whose url is not an allow-listed gallery path (SSRF guard)', async () => {
    noDuplicateDb();
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [
      { drNumber: 'DR1', filename: 'p.jpg', url: 'http://169.254.169.254/latest/meta-data/', stepNumber: 1, decision: 'good', confidence: 0.9 },
    ] }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body?.data).toMatchObject({ saved: 0 });
    // No DB writes attempted for a rejected URL.
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('persists a good decision into both tables and counts it', async () => {
    noDuplicateDb();
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [
      { drNumber: 'DR1', filename: 'p.jpg', url: VALID_URL, stepNumber: 6, decision: 'good', confidence: 0.95 },
    ] }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body?.data).toMatchObject({ saved: 1, good: 1, bad: 0, skipped: 0 });
    const sqls = mocks.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO vlm_corrections/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO vlm_visual_photo_examples/i.test(s))).toBe(true);
    // source_id must NOT be written (it is UUID-typed); source_table='gallery' instead.
    expect(sqls.some((s) => /INSERT INTO vlm_corrections[\s\S]*source_table/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO vlm_corrections[\s\S]*source_id/i.test(s))).toBe(false);
  });

  it('marks a bad decision as reject', async () => {
    noDuplicateDb();
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [
      { drNumber: 'DR1', filename: 'p.jpg', url: VALID_URL, stepNumber: 6, decision: 'bad', confidence: 0.2 },
    ] }), res);
    expect(captured.body?.data).toMatchObject({ saved: 1, good: 0, bad: 1 });
    const correctionsCall = mocks.query.mock.calls.find((c) => /INSERT INTO vlm_corrections/i.test(String(c[0])));
    expect(correctionsCall?.[1]).toContain('reject');
  });

  it('skips an already-curated photo (dedup)', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve({ rows: [{ id: 'x' }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [
      { drNumber: 'DR1', filename: 'p.jpg', url: VALID_URL, stepNumber: 6, decision: 'good', confidence: 0.95 },
    ] }), res);
    expect(captured.body?.data).toMatchObject({ saved: 0, skipped: 1 });
    expect(mocks.query.mock.calls.every((c) => /^\s*SELECT/i.test(String(c[0])))).toBe(true);
  });

  it('continues on a per-item DB error (partial success)', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 });
      if (/vlm_corrections/i.test(sql)) return Promise.reject(new Error('insert failed'));
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ decisions: [
      { drNumber: 'DR1', filename: 'p.jpg', url: VALID_URL, stepNumber: 6, decision: 'good', confidence: 0.95 },
    ] }), res);
    // Did not throw; reports nothing saved.
    expect(captured.statusCode).toBe(200);
    expect(captured.body?.data).toMatchObject({ saved: 0 });
  });
});

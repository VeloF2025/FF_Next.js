/**
 * H&S safety-library endpoints — the invariants that keep one table with a
 * content_type discriminator honest, plus the guards added after blind review.
 *
 * The central rule: a procedure row can never carry a supplier / GHS hazard
 * class / storage location, because the DB enforces that
 * (hs_safety_library_chemical_fields_msds_only). Every path that could produce
 * such a row must be a 400 BEFORE the query runs — not a CHECK violation
 * surfacing as a 500.
 *
 * These tests assert the values actually BOUND into the SQL, not just the
 * status code: the original bug was a guard that trimmed while the write bound
 * the raw input, so a whitespace-only value read as "absent" at the guard and
 * still reached Postgres as a non-NULL string. A status-only assertion would
 * have passed against that bug.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withPermission: () => (h: unknown) => h,
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));

import indexHandler from '../../../../pages/api/health-safety/library/index';
import detailHandler from '../../../../pages/api/health-safety/library/[libraryId]';

const EXISTING_MSDS = {
  id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  content_type: 'msds',
  title: 'Isopropyl Alcohol',
  reference: null,
  version: null,
  project_id: null,
  file_url: null,
  file_name: null,
  effective_date: '2026-01-01',
  review_date: '2027-01-01',
  notes: null,
  is_active: true,
  supplier: 'Acme Chemicals',
  ghs_hazard_class: 'Flammable liquid, Category 2',
  storage_location: 'Flammables cabinet, Store 1',
  updated_at_token: '2026-07-27 15:00:00.123456+00',
};

/** The bound interpolated values of a tagged-template call. */
function boundValues(call: unknown[]): unknown[] {
  return call.slice(1);
}
function queryText(call: unknown[]): string {
  return (call[0] as string[]).join(' ? ').replace(/\s+/g, ' ');
}

async function post(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await indexHandler(req, res);
  return res;
}
async function patch(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PATCH',
    query: { libraryId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' },
    body,
  });
  await detailHandler(req, res);
  return res;
}
async function list(query: Record<string, string>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query });
  await indexHandler(req, res);
  return res;
}

describe('POST /api/health-safety/library — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([{ id: 'new-1', title: 'X', content_type: 'msds' }]);
  });

  it('rejects an unknown content_type', async () => {
    expect((await post({ content_type: 'poster', title: 'Fire drill' }))._getStatusCode()).toBe(400);
  });

  it('rejects a missing, blank or whitespace-only title', async () => {
    expect((await post({ content_type: 'swp' }))._getStatusCode()).toBe(400);
    expect((await post({ content_type: 'swp', title: '   ' }))._getStatusCode()).toBe(400);
  });

  it('rejects chemical fields on a non-msds entry', async () => {
    const res = await post({
      content_type: 'swp',
      title: 'Working at Heights',
      ghs_hazard_class: 'Flammable liquid, Category 2',
    });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/ghs_hazard_class/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('accepts chemical fields on an msds entry', async () => {
    expect(
      (
        await post({
          content_type: 'msds',
          title: 'Isopropyl Alcohol',
          supplier: 'Acme Chemicals',
          ghs_hazard_class: 'Flammable liquid, Category 2',
          storage_location: 'Flammables cabinet',
        })
      )._getStatusCode()
    ).toBe(201);
  });

  it('rejects a review_date before the effective_date', async () => {
    expect(
      (
        await post({
          content_type: 'swp',
          title: 'Trenching and Excavation',
          effective_date: '2026-06-01',
          review_date: '2026-01-01',
        })
      )._getStatusCode()
    ).toBe(400);
  });

  it('normalises blank AND whitespace-only chemical fields to NULL rather than binding them', async () => {
    // The regression this pins: '   ' is falsy-looking to a trimming guard but
    // truthy to `||`, so `'   ' || null` bound a non-NULL value into a column
    // the DB requires to be NULL on a non-msds row → CHECK violation → 500.
    const res = await post({
      content_type: 'swp',
      title: 'Working at Heights',
      supplier: '',
      ghs_hazard_class: '   ',
      storage_location: null,
    });
    expect(res._getStatusCode()).toBe(201);

    const bound = boundValues(sqlMock.mock.calls[0]!);
    expect(bound).not.toContain('   ');
    expect(bound).not.toContain('');
  });

  it('rejects a file_url whose scheme is not http(s) or a same-origin path', async () => {
    const res = await post({
      content_type: 'swp',
      title: 'Working at Heights',
      file_url: 'javascript:alert(document.cookie)',
    });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed project_id rather than letting the ::uuid cast 500', async () => {
    const res = await post({ content_type: 'swp', title: 'X', project_id: 'not-a-uuid' });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/health-safety/library — filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it('rejects a malformed project_id filter with 400, before touching the DB', async () => {
    const res = await list({ project_id: 'not-a-uuid' });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('uses the same review_status CASE in the filter as in the projection', async () => {
    await list({ review_status: 'review_overdue' });
    const sqlText = queryText(sqlMock.mock.calls[0]!);

    // The expression appears twice — once projected as review_status, once in
    // the WHERE that the review_status filter compares against. Non-greedy, so
    // each match stops at its own END. If the two ever diverge, the endpoint
    // could return a row carrying a status the filter did not ask for.
    const caseBlocks = sqlText.match(/CASE WHEN l\.review_date[\s\S]*?ELSE 'current' END/g) ?? [];
    expect(caseBlocks).toHaveLength(2);
    expect(new Set(caseBlocks).size).toBe(1);
  });
});

describe('PATCH /api/health-safety/library/[libraryId] — resulting-row invariants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects switching an MSDS to a procedure while its chemical fields are still populated', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING_MSDS]);
    const res = await patch({ content_type: 'swp' });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/Safety Data Sheet/);
    expect(sqlMock).toHaveBeenCalledTimes(1); // SELECT only — the UPDATE never ran
  });

  it('treats empty-string chemical fields as cleared and binds NULL, not ""', async () => {
    // The HIGH from blind review: '' passed the trimming guard (read as
    // "cleared") but was bound verbatim, violating the msds-only CHECK as a 500.
    sqlMock
      .mockResolvedValueOnce([EXISTING_MSDS])
      .mockResolvedValueOnce([{ ...EXISTING_MSDS, content_type: 'swp', supplier: null }])
      .mockResolvedValueOnce([]);

    const res = await patch({
      content_type: 'swp',
      supplier: '',
      ghs_hazard_class: '  ',
      storage_location: '',
    });

    expect(res._getStatusCode()).toBe(200);
    const bound = boundValues(sqlMock.mock.calls[1]!);
    expect(bound).not.toContain('');
    expect(bound).not.toContain('  ');
  });

  it('allows the switch when the chemical fields are cleared with explicit nulls', async () => {
    sqlMock
      .mockResolvedValueOnce([EXISTING_MSDS])
      .mockResolvedValueOnce([{ ...EXISTING_MSDS, content_type: 'swp', supplier: null }])
      .mockResolvedValueOnce([]);

    const res = await patch({
      content_type: 'swp',
      supplier: null,
      ghs_hazard_class: null,
      storage_location: null,
    });
    expect(res._getStatusCode()).toBe(200);
  });

  it('guards the UPDATE with the updated_at token and 409s when it no longer matches', async () => {
    sqlMock
      .mockResolvedValueOnce([EXISTING_MSDS]) // SELECT
      .mockResolvedValueOnce([]); //             UPDATE matched nothing

    const res = await patch({ notes: 'x' });

    expect(res._getStatusCode()).toBe(409);
    expect(queryText(sqlMock.mock.calls[1]!)).toMatch(/AND updated_at::text = \?/);
    expect(boundValues(sqlMock.mock.calls[1]!)).toContain(EXISTING_MSDS.updated_at_token);
    expect(sqlMock).toHaveBeenCalledTimes(2); // no activity log for a write that did not happen
  });

  it('reads the token as ::text so microsecond precision survives the round-trip', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING_MSDS]).mockResolvedValueOnce([EXISTING_MSDS]).mockResolvedValueOnce([]);
    await patch({ notes: 'x' });
    expect(queryText(sqlMock.mock.calls[0]!)).toMatch(/updated_at::text AS updated_at_token/);
  });

  it('rejects an unsafe file_url on update', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING_MSDS]);
    const res = await patch({ file_url: 'javascript:alert(1)' });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects blanking the title', async () => {
    sqlMock.mockResolvedValueOnce([EXISTING_MSDS]);
    const res = await patch({ title: '  ' });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('404s on an unknown id without attempting an update', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await patch({ title: 'Anything' });
    expect(res._getStatusCode()).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

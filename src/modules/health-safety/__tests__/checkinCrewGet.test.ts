/**
 * GET /api/my/hs/checkin-crew — the bootstrap read for the crew form.
 *
 * The read is gated exactly like the write: the response contains every
 * contractor's worker roster, which is not a general permission. The test that
 * matters most is the negative one — a refused role must get NOTHING, i.e. the
 * roster queries must not even run.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { poolSqlMock, sessionRef } = vi.hoisted(() => ({
  poolSqlMock: vi.fn(),
  sessionRef: {
    current: { staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', staffName: 'Test Lead' },
  },
}));

vi.mock('@/lib/db-pool', () => ({ sql: poolSqlMock, transaction: vi.fn() }));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (h: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, sessionRef.current),
}));

import crewHandler from '../../../../pages/api/my/hs/checkin-crew';

/** Route every query by its text, so the mock does not depend on call order. */
function primeQueries(role: string | null) {
  poolSqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('FROM staff')) return Promise.resolve([{ role }]);
    if (text.includes('FROM projects')) {
      return Promise.resolve([{ id: 'p1', project_name: 'Lawley' }]);
    }
    if (text.includes('FROM contractors')) {
      return Promise.resolve([{ id: 'c1', company_name: 'DigCo' }]);
    }
    if (text.includes('FROM team_members')) {
      return Promise.resolve([{ id: 't1', name: 'Thabo M', contractor_id: null }]);
    }
    if (text.includes('FROM hs_daily_checkins')) return Promise.resolve([{ n: 3 }]);
    return Promise.resolve([]);
  });
}

function queriedTexts(): string[] {
  return poolSqlMock.mock.calls.map((c) => (c[0] as TemplateStringsArray).join(' '));
}

async function call(method: 'GET' | 'PUT' | 'DELETE') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method });
  await (crewHandler as unknown as (q: NextApiRequest, r: NextApiResponse) => Promise<void>)(
    req,
    res
  );
  return res;
}

describe('GET /api/my/hs/checkin-crew — role gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([['technician'], ['casual'], ['stores'], ['driver'], [null]])(
    'refuses role %s without running a single roster query',
    async (role) => {
      primeQueries(role);
      const res = await call('GET');
      expect(res._getStatusCode()).toBe(403);
      const texts = queriedTexts();
      expect(texts.some((t) => t.includes('FROM team_members'))).toBe(false);
      expect(texts.some((t) => t.includes('FROM contractors'))).toBe(false);
      expect(texts.some((t) => t.includes('FROM projects'))).toBe(false);
    }
  );

  it.each([['supervisor'], ['admin']])('returns the bootstrap lists for role %s', async (role) => {
    primeQueries(role);
    const res = await call('GET');
    expect(res._getStatusCode()).toBe(200);
    const { data } = JSON.parse(res._getData());
    expect(data.projects).toEqual([{ id: 'p1', project_name: 'Lawley' }]);
    expect(data.contractors).toEqual([{ id: 'c1', company_name: 'DigCo' }]);
    expect(data.team_members).toEqual([{ id: 't1', name: 'Thabo M', contractor_id: null }]);
    expect(data.recorded_today).toBe(3);
    // The activity vocabulary rides along so the form is one round-trip.
    expect(data.activities.map((a: { value: string }) => a.value)).toContain('working_at_heights');
  });

  it('still refuses methods other than GET and POST', async () => {
    primeQueries('supervisor');
    const res = await call('PUT');
    expect(res._getStatusCode()).toBe(405);
  });
});

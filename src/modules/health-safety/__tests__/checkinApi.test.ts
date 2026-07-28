/**
 * Daily check-in endpoints — the invariants that must hold at the boundary.
 *
 * Two matter most:
 *  - a crew submission without a contractor is refused BEFORE any write, because
 *    such rows never reach the gate they exist to feed (the same defect class
 *    fixed for medicals in #2269, here refused at the door as well as by a DB
 *    CHECK);
 *  - only a supervisor or admin may attest on behalf of other people.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, poolSqlMock, sessionRef } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  poolSqlMock: vi.fn(),
  sessionRef: { current: { staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', staffName: 'Test Lead' } },
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/db-pool', () => ({ sql: poolSqlMock }));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (h: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, sessionRef.current),
}));

import crewHandler from '../../../../pages/api/my/hs/checkin-crew';

const PROJECT = '11111111-2222-4333-8444-555555555555';
const CONTRACTOR = '66666666-7777-4888-8999-aaaaaaaaaaaa';

async function postCrew(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await (crewHandler as unknown as (q: NextApiRequest, r: NextApiResponse) => Promise<void>)(req, res);
  return res;
}

/** The role lookup is the first pool query the crew handler makes. */
function asRole(role: string | null) {
  poolSqlMock.mockResolvedValueOnce([{ role }]);
}

describe('POST /api/my/hs/checkin-crew — who may attest for others', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it.each([['technician'], ['stores'], ['driver'], [null]])(
    'refuses role %s — attesting for other people is not a general permission',
    async (role) => {
      asRole(role);
      const res = await postCrew({ project_id: PROJECT, contractor_id: CONTRACTOR });
      expect(res._getStatusCode()).toBe(403);
      expect(sqlMock).not.toHaveBeenCalled();
    }
  );

  it.each([['supervisor'], ['admin']])('allows role %s to reach validation', async (role) => {
    asRole(role);
    const res = await postCrew({ project_id: PROJECT, contractor_id: CONTRACTOR });
    // Past the role gate; fails later on the missing crew/ppe fields.
    expect(res._getStatusCode()).toBe(400);
  });
});

describe('POST /api/my/hs/checkin-crew — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it('refuses a crew submission with no contractor, before writing anything', async () => {
    asRole('supervisor');
    const res = await postCrew({
      project_id: PROJECT,
      ppe_complete: true,
      crew: [{ worker_name: 'A' }],
    });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/contractor_id is required/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed contractor_id rather than letting the ::uuid cast 500', async () => {
    asRole('supervisor');
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: 'not-a-uuid',
      ppe_complete: true,
      crew: [{ worker_name: 'A' }],
    });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('refuses the same worker listed twice in one submission', async () => {
    asRole('supervisor');
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Thabo M' }, { worker_name: '  thabo m  ' }],
    });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/listed twice/);
  });

  it('refuses an empty crew and a nameless member', async () => {
    asRole('supervisor');
    expect(
      (await postCrew({ project_id: PROJECT, contractor_id: CONTRACTOR, ppe_complete: true, crew: [] }))._getStatusCode()
    ).toBe(400);
    asRole('supervisor');
    expect(
      (
        await postCrew({
          project_id: PROJECT,
          contractor_id: CONTRACTOR,
          ppe_complete: true,
          crew: [{ worker_name: '   ' }],
        })
      )._getStatusCode()
    ).toBe(400);
  });

  it('refuses an unknown declared activity instead of silently dropping it', async () => {
    // Dropping it would let a caller declare height work with a typo and skip
    // the medical gate entirely.
    asRole('supervisor');
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      declared_activities: ['abseiling'],
      crew: [{ worker_name: 'A' }],
    });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

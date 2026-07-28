/**
 * Fixes from the blind review of PR #2273.
 *
 * The HIGH is the one that mattered most: per-member `fit_for_duty` was derived
 * as `raw.fit_for_duty !== false`, so anything but the literal boolean `false`
 * — the STRING "false", `0`, `null` — was silently treated as fit. The DB CHECK
 * cannot catch that, because the row it receives already claims fit_for_duty is
 * true. A malformed client could therefore flip a self-declared-unfit worker to
 * cleared, defeating the feature's central guarantee.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';

const { sqlMock, poolSqlMock, txnQueryMock, sessionRef } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  poolSqlMock: vi.fn(),
  txnQueryMock: vi.fn(),
  sessionRef: {
    current: { staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', staffName: 'Lead' },
  },
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/db-pool', () => ({
  sql: poolSqlMock,
  transaction: (cb: (t: unknown) => unknown) => cb({ query: txnQueryMock, queryOne: txnQueryMock }),
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (h: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, sessionRef.current),
}));

import crewHandler from '../../../../pages/api/my/hs/checkin-crew';

const PROJECT = '11111111-2222-4333-8444-555555555555';
const CONTRACTOR = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const MEMBER = '99999999-8888-4777-8666-555555555555';

async function postCrew(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await (crewHandler as unknown as (q: NextApiRequest, r: NextApiResponse) => Promise<void>)(req, res);
  return res;
}

describe('HIGH: per-member fit_for_duty is a strict boolean', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolSqlMock.mockResolvedValue([{ role: 'supervisor' }]);
    sqlMock.mockResolvedValue([]);
    txnQueryMock.mockResolvedValue([]);
  });

  it.each([['false'], [0], [null], ['no'], [{}]])(
    'rejects a non-boolean fit_for_duty (%j) instead of reading it as fit',
    async (value) => {
      const res = await postCrew({
        project_id: PROJECT,
        contractor_id: CONTRACTOR,
        ppe_complete: true,
        crew: [{ worker_name: 'Thabo', fit_for_duty: value }],
      });
      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData()).error.message).toMatch(/must be true or false/);
      // Nothing may be written from a submission we could not read correctly.
      expect(txnQueryMock).not.toHaveBeenCalled();
    }
  );

  it('still treats an omitted fit_for_duty as fit (the lead unticks to mark unfit)', async () => {
    poolSqlMock.mockResolvedValue([{ role: 'supervisor' }]);
    txnQueryMock.mockResolvedValue([]);
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Thabo' }],
    });
    expect(res._getStatusCode()).toBe(201);
  });

  it('honours an explicit false', async () => {
    poolSqlMock.mockResolvedValue([{ role: 'supervisor' }]);
    txnQueryMock.mockResolvedValue([]);
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Thabo', fit_for_duty: false }],
    });
    expect(res._getStatusCode()).toBe(201);
  });
});

describe('MEDIUM: contractor binding is conditional, not strict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolSqlMock.mockResolvedValue([{ role: 'supervisor' }]);
    sqlMock.mockResolvedValue([]);
  });

  it('refuses a worker registered to a DIFFERENT contractor', async () => {
    txnQueryMock.mockResolvedValueOnce([
      { id: MEMBER, contractor_id: '00000000-0000-4000-8000-000000000000' },
    ]);
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Someone else', team_member_id: MEMBER }],
    });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/different contractor/i);
  });

  it('ACCEPTS a worker whose contractor is not recorded, and says the link is unverified', async () => {
    // team_members.contractor_id is NULL for every live row. A strict check
    // would reject every real worker, pushing leads to name-only submissions —
    // and a worker with no id cannot have their medical verified, which would
    // downgrade the medical gate to advisory for all subcontractor workers.
    txnQueryMock
      .mockResolvedValueOnce([{ id: MEMBER, contractor_id: null }]) // classify
      .mockResolvedValueOnce([]) // no duplicate by id
      .mockResolvedValueOnce([]) // no duplicate by name
      .mockResolvedValue([{ worker_name: 'Thabo', clearance: 'cleared' }]); // insert
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Thabo', team_member_id: MEMBER }],
    });
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData()).data.contractor_link_unverified).toEqual(['Thabo']);
  });

  it('refuses an id matching no team_members row at all', async () => {
    txnQueryMock.mockResolvedValueOnce([]); // nothing found => foreign
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Ghost', team_member_id: MEMBER }],
    });
    expect(res._getStatusCode()).toBe(400);
  });
});

describe('MEDIUM: duplicates are refused by name on BOTH paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolSqlMock.mockResolvedValue([{ role: 'supervisor' }]);
    sqlMock.mockResolvedValue([]);
  });

  it('refuses a registered worker already recorded today', async () => {
    txnQueryMock
      .mockResolvedValueOnce([{ id: MEMBER, contractor_id: CONTRACTOR }])
      .mockResolvedValueOnce([{ team_member_id: MEMBER }]);
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: 'Thabo', team_member_id: MEMBER }],
    });
    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData()).error.message).toMatch(/Already checked in today/);
  });

  it('refuses a NAME-ONLY worker already recorded today, by name', async () => {
    // Previously this was absorbed by ON CONFLICT DO NOTHING with no message —
    // the quiet drop migration 466's own comment says it is avoiding.
    // classifyTeamMembers and findCrewAlreadyCheckedIn both early-return
    // without querying when there are no ids, so the name lookup is the FIRST
    // query this request makes.
    txnQueryMock.mockResolvedValueOnce([{ name: 'thabo m' }]);
    const res = await postCrew({
      project_id: PROJECT,
      contractor_id: CONTRACTOR,
      ppe_complete: true,
      crew: [{ worker_name: '  Thabo M  ' }],
    });
    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData()).error.message).toMatch(/Thabo M/);
  });
});

describe('MEDIUM: dates and vocabularies do not drift', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('validity checks use the SAST day, never Postgres CURRENT_DATE', () => {
    // The dev/prod session timezone is UTC. Between 00:00 and 02:00 SAST the two
    // disagree by a day, so a certificate that expired yesterday would still read
    // as valid for exactly the height/plant work the medical gate exists to stop.
    const svc = read('src/modules/health-safety/services/checkinService.ts');
    expect(svc).toMatch(/expiry_date >= \$\{asOfDate\}::date/);
    expect(svc).toMatch(/valid_from <= \$\{asOfDate\}::date/);
    expect(svc).toMatch(/valid_to >= \$\{asOfDate\}::date/);
    // No bare CURRENT_DATE left in a validity comparison.
    expect(svc).not.toMatch(/(expiry_date|valid_from|valid_to)[^\n]*CURRENT_DATE/);
  });

  it('the rollup binds the medical-gated activity list instead of hardcoding it', () => {
    const svc = read('src/modules/health-safety/services/checkinService.ts');
    expect(svc).toMatch(/declared_activities && \$\{MEDICAL_REQUIRED_ACTIVITIES\}::text\[\]/);
    expect(svc).not.toMatch(/ARRAY\['working_at_heights','confined_space','plant_operation'\]/);
  });

  it('migration 466 adds per-day crew uniqueness and persists the permit finding', () => {
    const m = read('scripts/migrations/sql/466_hs_daily_checkins_review_fixes.sql');
    expect(m).toMatch(/hs_daily_checkins_one_crew_member_per_day/);
    expect(m).toMatch(/hs_daily_checkins_one_crew_name_per_day/);
    expect(m).toMatch(/ADD COLUMN IF NOT EXISTS activities_without_permit/);
  });

  it('the board derives the permit warning from the stored column', () => {
    const board = read('pages/api/health-safety/checkins/index.ts');
    expect(board).toMatch(/row\.activities_without_permit/);
    expect(board).toMatch(/activity_without_permit/);
  });
});

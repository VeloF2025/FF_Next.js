/**
 * POST /api/my/hs/checkin — office declarations.
 *
 * An office worker has no project and answers one question (fit for duty).
 * The site path must keep working unchanged for the standalone check-in page,
 * which posts no `work_location` until Task 7 ships.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sessionRef, findSelfCheckinSpy, lookupMedicalStatusSpy, findActivitiesWithoutPermitSpy, createCheckinSpy, raiseHazardSpy } =
  vi.hoisted(() => ({
    sessionRef: {
      current: { staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', staffName: 'Test Worker' },
    },
    findSelfCheckinSpy: vi.fn(),
    lookupMedicalStatusSpy: vi.fn(),
    findActivitiesWithoutPermitSpy: vi.fn(),
    createCheckinSpy: vi.fn(),
    raiseHazardSpy: vi.fn(),
  }));

vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (h: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      h(req, res, sessionRef.current),
}));
vi.mock('@/modules/health-safety/services/checkinService', () => ({
  findSelfCheckin: findSelfCheckinSpy,
  lookupMedicalStatus: lookupMedicalStatusSpy,
  findActivitiesWithoutPermit: findActivitiesWithoutPermitSpy,
}));
vi.mock('@/modules/health-safety/services/checkinWrite', () => ({
  createCheckin: createCheckinSpy,
  raiseHazardToRiskRegister: raiseHazardSpy,
}));

import handler from '../../../../../pages/api/my/hs/checkin';

const PROJECT = '11111111-2222-4333-8444-555555555555';

async function post(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await (handler as unknown as (q: NextApiRequest, r: NextApiResponse) => Promise<void>)(req, res);
  return res;
}

function bodyOf(res: ReturnType<typeof createMocks>['res']) {
  return JSON.parse(res._getData());
}

describe('POST /api/my/hs/checkin — office declarations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSelfCheckinSpy.mockResolvedValue(null);
    lookupMedicalStatusSpy.mockResolvedValue('current');
    findActivitiesWithoutPermitSpy.mockResolvedValue([]);
    createCheckinSpy.mockResolvedValue({ id: 'checkin-1', checkin_date: '2026-08-20' });
    raiseHazardSpy.mockResolvedValue(null);
  });

  it('accepts an office body with no project_id', async () => {
    const res = await post({ work_location: 'office', fit_for_duty: true });
    expect(res._getStatusCode()).toBe(201);
    expect(createCheckinSpy.mock.calls[0][0].workLocation).toBe('office');
    expect(createCheckinSpy.mock.calls[0][0].projectId).toBeNull();
  });

  it('rejects a site body with no project_id', async () => {
    const res = await post({ work_location: 'site', fit_for_duty: true, ppe_complete: true });
    expect(res._getStatusCode()).toBe(400);
    expect(bodyOf(res).error.message).toMatch(/project_id/);
    expect(createCheckinSpy).not.toHaveBeenCalled();
  });

  it('defaults to site when work_location is absent', async () => {
    // The standalone page posts no work_location until Task 7 ships. It must
    // keep working in the meantime.
    const res = await post({ project_id: PROJECT, fit_for_duty: true, ppe_complete: true });
    expect(res._getStatusCode()).toBe(201);
    expect(createCheckinSpy.mock.calls[0][0].workLocation).toBe('site');
    expect(createCheckinSpy.mock.calls[0][0].projectId).toBe(PROJECT);
  });

  it('skips the medical and permit lookups for an office declaration', async () => {
    const res = await post({ work_location: 'office', fit_for_duty: true });
    expect(res._getStatusCode()).toBe(201);
    expect(lookupMedicalStatusSpy).not.toHaveBeenCalled();
    expect(findActivitiesWithoutPermitSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown work_location', async () => {
    const res = await post({ work_location: 'moon', fit_for_duty: true });
    expect(res._getStatusCode()).toBe(400);
    expect(createCheckinSpy).not.toHaveBeenCalled();
  });

  it('skips the risk-register call for an office hazard, storing it on the row only', async () => {
    const res = await post({ work_location: 'office', fit_for_duty: true, hazard_reported: 'Loose carpet tile' });
    expect(res._getStatusCode()).toBe(201);
    expect(raiseHazardSpy).not.toHaveBeenCalled();
    expect(createCheckinSpy.mock.calls[0][0].riskRegisterId).toBeNull();
    expect(createCheckinSpy.mock.calls[0][0].hazardReported).toBe('Loose carpet tile');
  });

  it('still raises a site hazard to the risk register', async () => {
    const res = await post({
      work_location: 'site',
      project_id: PROJECT,
      fit_for_duty: true,
      ppe_complete: true,
      hazard_reported: 'Exposed cable',
    });
    expect(res._getStatusCode()).toBe(201);
    expect(raiseHazardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, hazard: 'Exposed cable' })
    );
  });

  it('blocks an office declaration only on self-declared unfitness, with no warnings', async () => {
    const res = await post({ work_location: 'office', fit_for_duty: false });
    expect(res._getStatusCode()).toBe(201);
    const body = bodyOf(res);
    expect(body.data.clearance).toBe('blocked');
    expect(body.data.blocked_reasons).toEqual(['self_declared_unfit']);
    expect(body.data.warnings).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  updateScope: vi.fn(),
  confirmPonMilestone: vi.fn(),
  recordZoneQa: vi.fn(),
  authCount: 0,
  permissionCalls: [] as Array<[string, string]>,
}));
vi.mock('@/lib/db', () => ({ default: {} }));
vi.mock('@/modules/construction-qa/zone-delivery/services/zoneDeliveryService', () => ({
  createZoneDeliveryService: () => h,
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => {
    h.authCount += 1;
    return handler;
  },
  withPermission: (permission: string, action: string) => {
    h.permissionCalls.push([permission, action]);
    return (handler: unknown) => handler;
  },
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import scopeHandler from '@/pages/api/zone-delivery/scope';
import milestoneHandler from '@/pages/api/zone-delivery/pon-milestone';
import zoneQaHandler from '@/pages/api/zone-delivery/zone-qa';
import { ZoneDeliveryError } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryErrors';

const projectId = '11111111-1111-4111-8111-111111111111';
const ponStageId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'supervisor@example.com',
};
const meta = {
  projectId,
  zoneNo: 7,
  expectedRowVersion: 2,
  effectiveAt: '2026-07-30T08:00:00.000Z',
  source: 'signed register',
};
function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return res as unknown as NextApiResponse & typeof res;
}
async function call(handler: unknown, method: string, body: unknown) {
  const res = response();
  await (handler as (req: NextApiRequest, res: NextApiResponse) => Promise<void>)(
    { method, body, headers: {}, query: {}, user } as unknown as NextApiRequest,
    res,
  );
  return res;
}

describe('zone delivery command routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses auth and every exact edit permission', () => {
    expect(h.authCount).toBe(3);
    expect(h.permissionCalls).toEqual(expect.arrayContaining([
      ['construction-qa.zone-delivery.scope-manage', 'edit'],
      ['construction-qa.zone-delivery.construction-confirm', 'edit'],
      ['construction-qa.zone-delivery.testing-confirm', 'edit'],
      ['construction-qa.zone-delivery.operations-confirm', 'edit'],
      ['construction-qa.zone-delivery.zone-qa-approve', 'edit'],
    ]));
  });

  it('passes validated scope input and the authenticated actor', async () => {
    h.updateScope.mockResolvedValue({ rowVersion: 3 });
    const body = {
      ...meta,
      pons: [{ ponStageId, scopeStatus: 'included' }],
    };
    const res = await call(scopeHandler, 'POST', body);
    expect(res.statusCode).toBe(200);
    expect(h.updateScope).toHaveBeenCalledWith(body, {
      userId: user.id,
      email: user.email,
      permission: 'construction-qa.zone-delivery.scope-manage',
    });
  });

  it.each([
    [{ ...meta, zoneNo: 0, pons: [] }, 'zoneNo'],
    [{ ...meta, expectedRowVersion: -1, pons: [] }, 'expectedRowVersion'],
    [{ ...meta, effectiveAt: 'invalid', pons: [] }, 'effectiveAt'],
    [{ ...meta, source: ' ', pons: [] }, 'source'],
    [{ ...meta, pons: [{ ponStageId, scopeStatus: 'unknown' }] }, 'scopeStatus'],
  ])('rejects malformed command data %j before service', async (body, field) => {
    const res = await call(scopeHandler, 'POST', body);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect(h.updateScope).not.toHaveBeenCalled();
  });

  it.each([
    ['civil_complete', 'confirm', 'construction-qa.zone-delivery.construction-confirm'],
    ['optical_complete', 'reopen', 'construction-qa.zone-delivery.construction-confirm'],
    ['testing_passed', 'confirm', 'construction-qa.zone-delivery.testing-confirm'],
    ['port_submitted', 'confirm', 'construction-qa.zone-delivery.operations-confirm'],
    ['port_approved', 'confirm', 'construction-qa.zone-delivery.operations-confirm'],
    ['technically_live', 'confirm', 'construction-qa.zone-delivery.operations-confirm'],
    ['civil_complete', 'link_maintenance', 'construction-qa.zone-delivery.operations-confirm'],
  ] as const)('selects %s/%s permission', async (milestone, action, permission) => {
    h.confirmPonMilestone.mockResolvedValue({ rowVersion: 3 });
    const body = { ...meta, ponStageId, milestone, action };
    const res = await call(milestoneHandler, 'POST', body);
    expect(res.statusCode).toBe(200);
    expect(h.confirmPonMilestone).toHaveBeenCalledWith(body, {
      userId: user.id,
      email: user.email,
      permission,
    });
  });

  it('rejects unknown milestone and action before permission/service dispatch', async () => {
    const res = await call(milestoneHandler, 'POST', {
      ...meta,
      ponStageId,
      milestone: 'unknown',
      action: 'erase',
    });
    expect(res.statusCode).toBe(400);
    expect(h.confirmPonMilestone).not.toHaveBeenCalled();
  });

  it('passes valid Zone QA commands with its exact actor permission', async () => {
    h.recordZoneQa.mockResolvedValue({ rowVersion: 3 });
    const body = {
      ...meta,
      discipline: 'civil',
      status: 'failed',
      notes: 'Rework required',
      snagIds: [ponStageId],
    };
    const res = await call(zoneQaHandler, 'POST', body);
    expect(res.statusCode).toBe(200);
    expect(h.recordZoneQa).toHaveBeenCalledWith(body, {
      userId: user.id,
      email: user.email,
      permission: 'construction-qa.zone-delivery.zone-qa-approve',
    });
  });

  it('rejects numeric strings for JSON zone and row-version fields across commands', async () => {
    const commands = [
      [scopeHandler, {
        ...meta,
        pons: [{ ponStageId, scopeStatus: 'included' }],
      }],
      [milestoneHandler, {
        ...meta,
        ponStageId,
        milestone: 'civil_complete',
        action: 'confirm',
      }],
      [zoneQaHandler, {
        ...meta,
        discipline: 'civil',
        status: 'passed',
        notes: '',
        snagIds: [],
      }],
    ] as const;
    for (const [route, body] of commands) {
      for (const field of ['zoneNo', 'expectedRowVersion'] as const) {
        const res = await call(route, 'POST', { ...body, [field]: String(body[field]) });
        expect(res.statusCode, `${field} on ${String(route)}`).toBe(400);
        expect(JSON.stringify(res.body)).toContain(field);
      }
    }
    expect(h.updateScope).not.toHaveBeenCalled();
    expect(h.confirmPonMilestone).not.toHaveBeenCalled();
    expect(h.recordZoneQa).not.toHaveBeenCalled();
  });

  it('maps version conflict and preserves structured blocker details', async () => {
    const conflict = Object.assign(
      new ZoneDeliveryError('VERSION_CONFLICT', 'reload'),
      { details: { blockers: [{ code: 'OPEN_SNAG', entityId: ponStageId }] } },
    );
    h.updateScope.mockRejectedValue(conflict);
    const res = await call(scopeHandler, 'POST', {
      ...meta,
      pons: [{ ponStageId, scopeStatus: 'included' }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'reload',
        details: { blockers: [{ code: 'OPEN_SNAG', entityId: ponStageId }] },
      },
    });
  });

  it('rejects unsupported command methods', async () => {
    const res = await call(scopeHandler, 'GET', {});
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });
});

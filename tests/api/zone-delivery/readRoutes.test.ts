import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  getRegister: vi.fn(),
  getZone: vi.fn(),
  getActivity: vi.fn(),
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

import registerHandler from '@/pages/api/zone-delivery/register';
import zoneHandler from '@/pages/api/zone-delivery/zone';
import activityHandler from '@/pages/api/zone-delivery/activity';

const projectId = '11111111-1111-4111-8111-111111111111';
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
async function call(handler: unknown, request: Partial<NextApiRequest>) {
  const res = response();
  await (handler as (req: NextApiRequest, res: NextApiResponse) => Promise<void>)(
    { headers: {}, query: {}, ...request } as NextApiRequest,
    res,
  );
  return res;
}

describe('zone delivery read routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wraps every read route with auth and qa-centre view permission', () => {
    expect(h.authCount).toBe(3);
    // Order follows module import order, which is incidental; what matters is
    // that all three reads are view-gated and that zone.ts's declare-handover
    // writer is edit-gated on the zone-level command permission — a viewer
    // must not reach it.
    expect(h.permissionCalls).toHaveLength(4);
    expect(h.permissionCalls.filter(
      ([key, action]: [string, string]) => key === 'construction-qa.qa-centre' && action === 'view',
    )).toHaveLength(3);
    expect(h.permissionCalls).toContainEqual(
      ['construction-qa.zone-delivery.zone-qa-approve', 'edit'],
    );
  });

  it('parses the approved register query filters', async () => {
    h.getRegister.mockResolvedValue({ rows: [], summary: {} });
    const res = await call(registerHandler, {
      method: 'GET',
      query: {
        project_id: projectId,
        zone_no: '7',
        status: 'testing_in_progress',
        blocker: 'test pack',
        handover: 'pending',
        search: 'Tembisa',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.getRegister).toHaveBeenCalledWith({
      projectId,
      zoneNo: 7,
      status: 'testing_in_progress',
      blocker: 'test pack',
      handover: 'pending',
      search: 'Tembisa',
    });
    expect(res.body).toMatchObject({ success: true, data: { rows: [] } });
  });

  it.each([
    [{ project_id: 'not-a-uuid' }, 'project_id'],
    [{ zone_no: '0' }, 'zone_no'],
    [{ status: 'unknown' }, 'status'],
    [{ handover: 'unknown' }, 'handover'],
  ])('rejects invalid register query %j before the service', async (query, field) => {
    const res = await call(registerHandler, { method: 'GET', query });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(res.body)).toContain(field);
    expect(h.getRegister).not.toHaveBeenCalled();
  });

  it.each([
    ['zone', zoneHandler, h.getZone],
    ['activity', activityHandler, h.getActivity],
  ] as const)('returns the %s view for a valid zone key', async (_name, handler, serviceMethod) => {
    serviceMethod.mockResolvedValue({ ok: true });
    const res = await call(handler, {
      method: 'GET',
      query: { project_id: projectId, zone_no: '7' },
    });
    expect(res.statusCode).toBe(200);
    expect(serviceMethod).toHaveBeenCalledWith({ projectId, zoneNo: 7 });
  });

  it('rejects unsupported methods without calling reads', async () => {
    // POST is now the declare-handover command, so DELETE stands in as the
    // unsupported method.
    const res = await call(zoneHandler, {
      method: 'DELETE',
      query: { project_id: projectId, zone_no: '7' },
    });
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST');
    expect(h.getZone).not.toHaveBeenCalled();
  });

  it('does not serve the zone read for a handover POST', async () => {
    // An empty body fails validation rather than falling through to the read.
    const res = await call(zoneHandler, {
      method: 'POST',
      query: { project_id: projectId, zone_no: '7' },
      body: {},
    });
    expect(res.statusCode).toBe(400);
    expect(h.getZone).not.toHaveBeenCalled();
  });
});

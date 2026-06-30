// tests/api/planning/items.test.ts
// Exercises the real App Router route handlers (list/create + [id]) with the
// service + RBAC auth boundary mocked. requirePermission is mocked so each test
// controls allow / 401 / 403 independently.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controls what requirePermission returns. user set => allowed; user null =>
// deny with denyStatus (401 unauth, 403 no-permission).
const auth = vi.hoisted(() => ({ user: null as null | { id: string }, denyStatus: 403 }));

vi.mock('@/lib/auth/app-router', () => ({
  requirePermission: vi.fn(async () => {
    if (auth.user) return [auth.user, null];
    const { NextResponse } = await import('next/server');
    return [null, NextResponse.json({ error: 'denied' }, { status: auth.denyStatus })];
  }),
}));

const svc = vi.hoisted(() => ({
  listPlanningItems: vi.fn(),
  createPlanningItem: vi.fn(),
  getPlanningItemById: vi.fn(),
  updatePlanningItem: vi.fn(),
  deletePlanningItem: vi.fn(),
  logPlanningActivity: vi.fn(),
}));
vi.mock('@/modules/planning/services/planningService', () => svc);

import { GET, POST } from '../../../app/api/planning/items/route';
import { PUT, DELETE, GET as GET_BY_ID } from '../../../app/api/planning/items/[id]/route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown) => ({ json: async () => body }) as never;
const urlReq = (url: string) => ({ url }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'user-123' }; // default: authenticated + permitted
  auth.denyStatus = 403;
});

describe('GET /api/planning/items', () => {
  it('returns 403 when the caller lacks planning view', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await GET(urlReq('http://localhost/api/planning/items'));
    expect(res.status).toBe(403);
    expect(svc.listPlanningItems).not.toHaveBeenCalled();
  });

  it('returns the paginated envelope when permitted', async () => {
    svc.listPlanningItems.mockResolvedValue({
      data: [], pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 },
    });
    const res = await GET(urlReq('http://localhost/api/planning/items'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.pagination).toHaveProperty('totalPages');
    expect(svc.listPlanningItems).toHaveBeenCalledTimes(1);
  });

  it('parses repeated exclude_stage params into a filter array', async () => {
    svc.listPlanningItems.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 } });
    await GET(urlReq('http://localhost/api/planning/items?exclude_stage=on_hold&exclude_stage=cancelled'));
    expect(svc.listPlanningItems).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_stage: ['on_hold', 'cancelled'] }),
    );
  });
});

describe('POST /api/planning/items', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await POST(req({ project_id: 'p', title: 'x' }));
    expect(res.status).toBe(401);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without create', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await POST(req({ project_id: 'p', title: 'x' }));
    expect(res.status).toBe(403);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects a body without project_id (400)', async () => {
    const res = await POST(req({ title: 'x' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid stage enum value (400)', async () => {
    const res = await POST(req({ project_id: 'p', title: 'x', stage: 'rogue' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('creates the item (201) with created_by from the authenticated user', async () => {
    svc.createPlanningItem.mockResolvedValue({ id: 'new-id', item_uid: 'PLN-1' });
    const res = await POST(req({ project_id: 'p', title: 'New plan' }));
    expect(res.status).toBe(201);
    expect(svc.createPlanningItem).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'p', title: 'New plan', created_by: 'user-123' }),
    );
    expect(svc.logPlanningActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
    );
  });
});

describe('GET /api/planning/items/[id]', () => {
  it('returns 403 when the caller lacks planning view', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await GET_BY_ID(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.getPlanningItemById).not.toHaveBeenCalled();
  });

  it('returns the item when permitted', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, title: 'x' });
    const res = await GET_BY_ID(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID);
  });
});

describe('PUT /api/planning/items/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without edit', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 404 when the item does not exist', async () => {
    svc.getPlanningItemById.mockResolvedValue(null);
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(404);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid stage enum value (400) before touching the DB', async () => {
    const res = await PUT(req({ stage: 'rogue' }), { params: { id: ID } });
    expect(res.status).toBe(400);
    expect(svc.getPlanningItemById).not.toHaveBeenCalled();
  });

  it('updates and logs with the authenticated user id', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, stage: 'intake' });
    svc.updatePlanningItem.mockResolvedValue({ id: ID, stage: 'hld' });
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(svc.logPlanningActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'stage_change', userId: 'user-123' }),
    );
  });
});

describe('DELETE /api/planning/items/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    auth.user = null; auth.denyStatus = 401;
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.deletePlanningItem).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated without delete', async () => {
    auth.user = null; auth.denyStatus = 403;
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(403);
    expect(svc.deletePlanningItem).not.toHaveBeenCalled();
  });

  it('cancels the item when permitted', async () => {
    svc.getPlanningItemById.mockResolvedValue({ id: ID, stage: 'intake' });
    svc.deletePlanningItem.mockResolvedValue({ id: ID, stage: 'cancelled' });
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(svc.deletePlanningItem).toHaveBeenCalledWith(ID);
    expect(svc.logPlanningActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'cancelled', userId: 'user-123' }),
    );
  });
});

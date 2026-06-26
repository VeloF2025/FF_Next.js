// tests/api/planning/items.test.ts
// Exercises the real App Router route handlers (list/create + [id]) — auth gates,
// input validation, and the filter-parsing pipeline — with the service + auth
// dependencies mocked. Replaces earlier placeholder tests that asserted on local
// objects instead of invoking production code.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable auth state, hoisted so the next/headers factory can read it.
const state = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ff_auth_token' && state.token ? { value: state.token } : undefined,
  }),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(async (token: string) => (token === 'valid' ? { sub: 'user-123' } : null)),
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
import { PUT, DELETE } from '../../../app/api/planning/items/[id]/route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown) => ({ json: async () => body }) as never;
const urlReq = (url: string) => ({ url }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.token = undefined;
});

describe('GET /api/planning/items', () => {
  it('returns the paginated envelope from the service', async () => {
    svc.listPlanningItems.mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 2500, total: 0, totalPages: 0 },
    });
    const res = await GET(urlReq('http://localhost/api/planning/items'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeInstanceOf(Array);
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
  it('rejects a body without project_id (400)', async () => {
    state.token = 'valid';
    const res = await POST(req({ title: 'x' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects a body without a title (400)', async () => {
    state.token = 'valid';
    const res = await POST(req({ project_id: 'p', title: '   ' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid stage enum value (400)', async () => {
    state.token = 'valid';
    const res = await POST(req({ project_id: 'p', title: 'x', stage: 'rogue' }));
    expect(res.status).toBe(400);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request (401)', async () => {
    state.token = undefined; // no cookie
    const res = await POST(req({ project_id: 'p', title: 'x' }));
    expect(res.status).toBe(401);
    expect(svc.createPlanningItem).not.toHaveBeenCalled();
  });

  it('creates the item for an authenticated request (201) with created_by from the token', async () => {
    state.token = 'valid';
    svc.createPlanningItem.mockResolvedValue({ id: 'new-id', item_uid: 'PLN-1' });
    const res = await POST(req({ project_id: 'p', title: 'New plan' }));
    expect(res.status).toBe(201);
    expect(svc.createPlanningItem).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'p', title: 'New plan', created_by: 'user-123' }),
    );
  });
});

describe('PUT/DELETE /api/planning/items/[id]', () => {
  it('PUT rejects an unauthenticated request (401)', async () => {
    state.token = undefined;
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('DELETE rejects an unauthenticated request (401)', async () => {
    state.token = undefined;
    const res = await DELETE(urlReq('http://localhost'), { params: { id: ID } });
    expect(res.status).toBe(401);
    expect(svc.deletePlanningItem).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when the item does not exist', async () => {
    state.token = 'valid';
    svc.getPlanningItemById.mockResolvedValue(null);
    const res = await PUT(req({ stage: 'hld' }), { params: { id: ID } });
    expect(res.status).toBe(404);
    expect(svc.updatePlanningItem).not.toHaveBeenCalled();
  });

  it('PUT rejects an invalid stage enum value (400) before touching the DB', async () => {
    state.token = 'valid';
    const res = await PUT(req({ stage: 'rogue' }), { params: { id: ID } });
    expect(res.status).toBe(400);
    expect(svc.getPlanningItemById).not.toHaveBeenCalled();
  });
});

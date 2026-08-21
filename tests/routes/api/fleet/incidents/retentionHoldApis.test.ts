import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRetentionHold: vi.fn(), reviewRetentionHold: vi.fn(), releaseRetentionHold: vi.fn(),
  listIncidentHoldsForViewer: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/retention/holdService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/retention/holdService')>(
    '@/modules/fleet/incidents/retention/holdService',
  );
  return {
    ...actual,
    createRetentionHold: mocks.createRetentionHold,
    reviewRetentionHold: mocks.reviewRetentionHold,
    releaseRetentionHold: mocks.releaseRetentionHold,
    listIncidentHoldsForViewer: mocks.listIncidentHoldsForViewer,
  };
});

import holdsHandler from '@/pages/api/fleet/incidents/[incidentId]/retention-holds/index';
import reviewHandler from '@/pages/api/fleet/incidents/[incidentId]/retention-holds/[holdId]/review';
import releaseHandler from '@/pages/api/fleet/incidents/[incidentId]/retention-holds/[holdId]/release';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  RetentionHoldAccessDeniedError, RetentionHoldConflictError, RetentionHoldValidationError,
} from '@/modules/fleet/incidents/retention/holdService';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const INCIDENT = '33333333-3333-4333-8333-333333333333';
const HOLD = '44444444-4444-4444-8444-444444444444';
const OWNER = '55555555-5555-4555-8555-555555555555';

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method: string,
  options: { query?: Record<string, string>; body?: unknown; user?: { id: string; role: string } | null } = {},
) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: options.query ?? { incidentId: INCIDENT, holdId: HOLD }, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'admin' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

const createBody = { category: 'legal', reason: 'Litigation pending', ownerUserId: OWNER, nextReviewAt: '2026-09-01T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gates.length = 0;
  mocks.staff.mockResolvedValue(STAFF);
  mocks.createRetentionHold.mockResolvedValue({ id: HOLD, status: 'active' });
  mocks.reviewRetentionHold.mockResolvedValue({ id: HOLD, status: 'active' });
  mocks.releaseRetentionHold.mockResolvedValue({ id: HOLD, status: 'released' });
  mocks.listIncidentHoldsForViewer.mockResolvedValue({ holds: [], actions: [], canManage: false });
});

describe('/api/fleet/incidents/[incidentId]/retention-holds', () => {
  it('gates on fleet incident access', async () => {
    await call(holdsHandler, 'GET');
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'view']);
  });

  it('allows GET and POST only', async () => {
    const result = await call(holdsHandler, 'DELETE');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET, POST');
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call(holdsHandler, 'GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.listIncidentHoldsForViewer).not.toHaveBeenCalled();
  });

  it('validates the incidentId path param before touching the body', async () => {
    const result = await call(holdsHandler, 'POST', { query: { incidentId: 'not-a-uuid' }, body: createBody });
    expect(result.status).toBe(400);
    expect(mocks.createRetentionHold).not.toHaveBeenCalled();
  });

  it('lists holds for a scoped viewer', async () => {
    mocks.listIncidentHoldsForViewer.mockResolvedValue({ holds: [{ id: HOLD }], actions: [], canManage: true });
    const result = await call(holdsHandler, 'GET');
    expect(result.status).toBe(200);
    expect(mocks.listIncidentHoldsForViewer).toHaveBeenCalledWith(INCIDENT, { userId: USER, staffId: STAFF, role: 'admin' });
  });

  it('creates a hold from the authenticated session, never from the body', async () => {
    const result = await call(holdsHandler, 'POST', { body: { ...createBody, actorUserId: 'someone-else' } });
    expect(result.status).toBe(200);
    const [command, actor] = mocks.createRetentionHold.mock.calls[0]!;
    expect(command).toMatchObject({ incidentId: INCIDENT, category: 'legal', ownerUserId: OWNER });
    expect(actor).toEqual({ userId: USER, staffId: STAFF, role: 'admin' });
  });

  it('rejects a body that is not an object', async () => {
    const result = await call(holdsHandler, 'POST', { body: 'legal' });
    expect(result.status).toBe(400);
    expect(mocks.createRetentionHold).not.toHaveBeenCalled();
  });

  it('rejects a category outside the known set before reaching the service', async () => {
    const result = await call(holdsHandler, 'POST', { body: { ...createBody, category: 'because_i_said_so' } });
    expect(result.status).toBe(400);
    expect(mocks.createRetentionHold).not.toHaveBeenCalled();
  });

  it('maps a missing hold permission to 403', async () => {
    mocks.createRetentionHold.mockRejectedValue(new RetentionHoldAccessDeniedError('nope'));
    expect((await call(holdsHandler, 'POST', { body: createBody })).status).toBe(403);
  });

  it('maps a duplicate active hold to 409', async () => {
    mocks.createRetentionHold.mockRejectedValue(new RetentionHoldConflictError('exists'));
    expect((await call(holdsHandler, 'POST', { body: createBody })).status).toBe(409);
  });

  it('maps a missing incident to 404', async () => {
    mocks.createRetentionHold.mockRejectedValue(new IncidentNotFoundError('gone'));
    expect((await call(holdsHandler, 'POST', { body: createBody })).status).toBe(404);
  });

  it('maps a validation error to 400', async () => {
    mocks.createRetentionHold.mockRejectedValue(new RetentionHoldValidationError('bad'));
    expect((await call(holdsHandler, 'POST', { body: createBody })).status).toBe(400);
  });

  // An unexpected failure is a 500, never a 200 with an empty hold list: a UI
  // that renders "no holds" on an error would invite a purge of held data.
  it('does not disguise an unexpected failure as an empty list', async () => {
    mocks.listIncidentHoldsForViewer.mockRejectedValue(new Error('db down'));
    expect((await call(holdsHandler, 'GET')).status).toBe(500);
  });
});

describe('/api/fleet/incidents/[incidentId]/retention-holds/[holdId]/review', () => {
  it('allows POST only', async () => {
    const result = await call(reviewHandler, 'GET');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('POST');
  });

  it('validates the holdId path param', async () => {
    const result = await call(reviewHandler, 'POST', {
      query: { incidentId: INCIDENT, holdId: 'nope' }, body: { note: 'ok', nextReviewAt: '2026-09-01T00:00:00.000Z' },
    });
    expect(result.status).toBe(400);
    expect(mocks.reviewRetentionHold).not.toHaveBeenCalled();
  });

  it('passes the path holdId, not a body-supplied one', async () => {
    await call(reviewHandler, 'POST', { body: { holdId: 'other', note: 'ok', nextReviewAt: '2026-09-01T00:00:00.000Z' } });
    expect(mocks.reviewRetentionHold.mock.calls[0]![0]).toMatchObject({ holdId: HOLD });
  });

  it('maps a hold released concurrently to 409', async () => {
    mocks.reviewRetentionHold.mockRejectedValue(new RetentionHoldConflictError('released'));
    const result = await call(reviewHandler, 'POST', { body: { note: 'ok', nextReviewAt: '2026-09-01T00:00:00.000Z' } });
    expect(result.status).toBe(409);
  });
});

describe('/api/fleet/incidents/[incidentId]/retention-holds/[holdId]/release', () => {
  it('allows POST only', async () => {
    const result = await call(releaseHandler, 'GET');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('POST');
  });

  it('releases with the path holdId and the session actor', async () => {
    const result = await call(releaseHandler, 'POST', { body: { releaseReason: 'Matter closed' } });
    expect(result.status).toBe(200);
    const [command, actor] = mocks.releaseRetentionHold.mock.calls[0]!;
    expect(command).toMatchObject({ holdId: HOLD, releaseReason: 'Matter closed' });
    expect(actor).toEqual({ userId: USER, staffId: STAFF, role: 'admin' });
  });

  it('maps a missing hold permission to 403', async () => {
    mocks.releaseRetentionHold.mockRejectedValue(new RetentionHoldAccessDeniedError('nope'));
    expect((await call(releaseHandler, 'POST', { body: { releaseReason: 'x' } })).status).toBe(403);
  });
});

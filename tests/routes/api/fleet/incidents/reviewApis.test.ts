import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), detail: vi.fn(), transition: vi.fn(), bulk: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/reviewService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/reviewService')>('@/modules/fleet/incidents/reviewService');
  return {
    ...actual,
    listIncidentsForViewer: mocks.list, getIncidentDetailForViewer: mocks.detail,
    transitionIncident: mocks.transition, bulkAcknowledgeIncidents: mocks.bulk,
  };
});

import listHandler from '@/pages/api/fleet/incidents/index';
import detailHandler from '@/pages/api/fleet/incidents/[incidentId]/index';
import actionsHandler from '@/pages/api/fleet/incidents/[incidentId]/actions';
import bulkHandler from '@/pages/api/fleet/incidents/bulk-acknowledge';
import { IncidentAccessDeniedError } from '@/modules/fleet/incidents/reviewService';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import { IncidentTransitionConflictError, IncidentTransitionForbiddenError, IncidentTransitionValidationError } from '@/modules/fleet/incidents/reviewTransitions';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const INCIDENT = '33333333-3333-4333-8333-333333333333';

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
    method, query: options.query ?? {}, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

beforeEach(() => { vi.clearAllMocks(); mocks.gates.length = 0; mocks.staff.mockResolvedValue(STAFF); });

describe('GET /api/fleet/incidents', () => {
  it('allows GET only', async () => {
    const result = await call(listHandler, 'POST');
    expect(result.status).toBe(405); expect(result.headers.Allow).toBe('GET');
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call(listHandler, 'GET', { user: null });
    expect(result.status).toBe(401);
  });

  it('rejects malformed filters before calling the service', async () => {
    const result = await call(listHandler, 'GET', { query: { projectId: 'not-a-uuid' } });
    expect(result.status).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
  });

  it('resolves the viewer scope and returns the list under the view permission gate', async () => {
    mocks.list.mockResolvedValue({ incidents: [], total: 0 });
    const result = await call(listHandler, 'GET', { query: { limit: '10' } });
    expect(result.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }), { userId: USER, staffId: STAFF, role: 'manager' });
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'view']);
  });

  it('maps access denial to 403 and never leaks a fake empty list', async () => {
    mocks.list.mockRejectedValue(new IncidentAccessDeniedError('denied'));
    const result = await call(listHandler, 'GET', {});
    expect(result.status).toBe(403);
  });

  it('does not convert a database failure into an empty list', async () => {
    mocks.list.mockRejectedValue(new Error('database down'));
    const result = await call(listHandler, 'GET', {});
    expect(result.status).toBe(500); expect(result.body).not.toMatchObject({ success: true });
  });
});

describe('GET /api/fleet/incidents/[incidentId]', () => {
  it('validates the incidentId path param', async () => {
    const result = await call(detailHandler, 'GET', { query: { incidentId: 'not-a-uuid' } });
    expect(result.status).toBe(400); expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('maps not found and forbidden distinctly', async () => {
    mocks.detail.mockRejectedValue(new IncidentNotFoundError('missing'));
    const notFound = await call(detailHandler, 'GET', { query: { incidentId: INCIDENT } });
    expect(notFound.status).toBe(404);

    mocks.detail.mockRejectedValue(new IncidentAccessDeniedError('denied'));
    const forbidden = await call(detailHandler, 'GET', { query: { incidentId: INCIDENT } });
    expect(forbidden.status).toBe(403);
  });

  it('returns coordinate-free incident detail', async () => {
    mocks.detail.mockResolvedValue({ id: INCIDENT, evidenceSnapshot: { reason: 'late' } });
    const result = await call(detailHandler, 'GET', { query: { incidentId: INCIDENT } });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toMatch(/latitude|longitude/i);
  });
});

describe('POST /api/fleet/incidents/[incidentId]/actions', () => {
  it('allows POST only and derives the actor from the session, never the body', async () => {
    const denied = await call(actionsHandler, 'GET', { query: { incidentId: INCIDENT } });
    expect(denied.status).toBe(405);

    mocks.transition.mockResolvedValue({ incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' });
    await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body: { actionType: 'acknowledged', actorUserId: 'attacker' } });
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: INCIDENT, actorUserId: USER, actionType: 'acknowledged' }),
      { userId: USER, staffId: STAFF, role: 'manager' },
    );
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'edit']);
  });

  it('rejects an invalid body before calling the service', async () => {
    const result = await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body: { actionType: 'bogus' } });
    expect(result.status).toBe(400); expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('returns 403 with the reason when the caller is the subject of the incident', async () => {
    mocks.transition.mockRejectedValue(new IncidentAccessDeniedError(
      'You cannot act on a Fleet incident that is about you — another oversight member must review it',
    ));

    const result = await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body: { actionType: 'acknowledged' } });

    expect(result.status).toBe(403);
    expect(JSON.stringify(result.body)).toMatch(/about you/i);
  });

  it('maps validation, forbidden, not-found, and conflict errors to their status codes', async () => {
    const body = { actionType: 'commented', note: 'x' };
    mocks.transition.mockRejectedValue(new IncidentTransitionValidationError('bad outcome'));
    expect((await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body })).status).toBe(400);
    mocks.transition.mockRejectedValue(new IncidentAccessDeniedError('denied'));
    expect((await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body })).status).toBe(403);
    mocks.transition.mockRejectedValue(new IncidentNotFoundError('missing'));
    expect((await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body })).status).toBe(404);
    mocks.transition.mockRejectedValue(new IncidentTransitionConflictError('closed', 'resolved'));
    expect((await call(actionsHandler, 'POST', { query: { incidentId: INCIDENT }, body })).status).toBe(409);
  });
});

describe('POST /api/fleet/incidents/bulk-acknowledge', () => {
  it('accepts only a non-empty array of incident ids', async () => {
    const result = await call(bulkHandler, 'POST', { body: { incidentIds: [] } });
    expect(result.status).toBe(400); expect(mocks.bulk).not.toHaveBeenCalled();
  });

  it('validates every incident before mutating any, surfacing a 409 when one is already closed', async () => {
    mocks.bulk.mockRejectedValue(new IncidentTransitionConflictError('one incident is already closed', 'resolved'));
    const result = await call(bulkHandler, 'POST', { body: { incidentIds: [INCIDENT] } });
    expect(result.status).toBe(409);
  });

  // A self-owned id fails the whole request before anything is acknowledged, so the caller
  // must be able to read WHICH ids were refused and that nothing else went through —
  // otherwise they have to re-submit blind to find out.
  it('returns 403 naming the refused ids when one incident in the batch is about the caller', async () => {
    mocks.bulk.mockRejectedValue(new IncidentTransitionForbiddenError(
      `You cannot act on a Fleet incident that is about you. Refused: ${INCIDENT}. No incident in this request was acknowledged.`,
    ));

    const result = await call(bulkHandler, 'POST', { body: { incidentIds: [INCIDENT] } });

    expect(result.status).toBe(403);
    expect(JSON.stringify(result.body)).toContain(INCIDENT);
    expect(JSON.stringify(result.body)).toMatch(/about you/i);
    expect(JSON.stringify(result.body)).toMatch(/No incident in this request was acknowledged/i);
  });

  it('acknowledges every requested incident and returns their results', async () => {
    mocks.bulk.mockResolvedValue({ results: [{ incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' }] });
    const result = await call(bulkHandler, 'POST', { body: { incidentIds: [INCIDENT] } });
    expect(result.status).toBe(200);
    expect(mocks.bulk).toHaveBeenCalledWith([INCIDENT], { userId: USER, staffId: STAFF, role: 'manager' }, null);
  });
});

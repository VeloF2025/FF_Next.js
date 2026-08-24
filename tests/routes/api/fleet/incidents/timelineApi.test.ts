import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/analytics/timelineService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/analytics/timelineService')>(
    '@/modules/fleet/incidents/analytics/timelineService',
  );
  return { ...actual, getIncidentTimeline: mocks.timeline };
});

import timelineHandler from '@/pages/api/fleet/incidents/[incidentId]/timeline';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  IncidentTimelineAccessDeniedError, IncidentTimelineCursorError,
} from '@/modules/fleet/incidents/analytics/timelineService';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const INCIDENT = '33333333-3333-4333-8333-333333333333';

const page = {
  entries: [{
    stableId: 'manager:44444444-4444-4444-8444-444444444444', source: 'manager', entryType: 'acknowledged',
    occurredAt: '2026-08-13T08:10:00.000Z', recordedAt: '2026-08-13T08:10:00.000Z',
    summary: 'Acknowledged', actorLabel: 'Thabo Nkosi',
  }],
  nextCursor: null,
};

async function call(
  method: string,
  options: { query?: Record<string, string | string[]>; user?: { id: string; role: string } | null } = {},
) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: options.query ?? { incidentId: INCIDENT },
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await timelineHandler(req as NextApiRequest, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gates.length = 0;
  mocks.staff.mockResolvedValue(STAFF);
  mocks.timeline.mockResolvedValue(page);
});

describe('GET /api/fleet/incidents/{incidentId}/timeline', () => {
  it('allows GET only', async () => {
    const result = await call('POST');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET');
  });

  it('gates on fleet.incidents view', async () => {
    await call('GET');
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'view']);
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call('GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it('rejects an incidentId that is not a UUID', async () => {
    const result = await call('GET', { query: { incidentId: 'not-a-uuid' } });
    expect(result.status).toBe(400);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it('returns the page for a permitted viewer', async () => {
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(mocks.timeline).toHaveBeenCalledWith(
      INCIDENT, { userId: USER, staffId: STAFF, role: 'manager' }, { limit: undefined, cursor: undefined },
    );
  });

  it('forwards limit and cursor', async () => {
    await call('GET', { query: { incidentId: INCIDENT, limit: '25', cursor: 'abc' } });
    expect(mocks.timeline).toHaveBeenCalledWith(
      INCIDENT, expect.anything(), { limit: 25, cursor: 'abc' },
    );
  });

  it('refuses a limit above the maximum instead of silently clamping it', async () => {
    const result = await call('GET', { query: { incidentId: INCIDENT, limit: '5000' } });
    expect(result.status).toBe(400);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it('refuses a non-numeric limit', async () => {
    const result = await call('GET', { query: { incidentId: INCIDENT, limit: 'ten' } });
    expect(result.status).toBe(400);
  });

  it('refuses an empty cursor rather than quietly answering page one', async () => {
    // `?cursor=` is a caller trying to page. Answering page one without saying
    // so is how a client silently restarts a walk it thought it was continuing.
    mocks.timeline.mockRejectedValue(new IncidentTimelineCursorError('The timeline cursor could not be read'));
    const result = await call('GET', { query: { incidentId: INCIDENT, cursor: '' } });
    expect(result.status).toBe(400);
    // The route must hand the empty string on as a cursor rather than dropping
    // it — it is the service that knows an empty position is not a first page.
    expect(mocks.timeline).toHaveBeenCalledWith(
      INCIDENT, expect.anything(), { limit: undefined, cursor: '' },
    );
  });

  it('refuses a repeated cursor parameter', async () => {
    const result = await call('GET', { query: { incidentId: INCIDENT, cursor: ['a', 'b'] } });
    expect(result.status).toBe(400);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it('answers 404 for an incident that does not exist', async () => {
    mocks.timeline.mockRejectedValue(new IncidentNotFoundError('No incident found'));
    const result = await call('GET');
    expect(result.status).toBe(404);
  });

  // Both the no-scope refusal and the out-of-scope refusal reach the route as
  // this one error, and both answer 403 — the same pair GET /api/fleet/incidents/[incidentId]
  // answers for the same two conditions.
  it('answers 403 for a viewer who may not see this incident', async () => {
    mocks.timeline.mockRejectedValue(new IncidentTimelineAccessDeniedError('You cannot view Fleet incidents'));
    const result = await call('GET');
    expect(result.status).toBe(403);
  });

  it('answers 400 for a cursor that cannot be read', async () => {
    mocks.timeline.mockRejectedValue(new IncidentTimelineCursorError('The timeline cursor could not be read'));
    const result = await call('GET');
    expect(result.status).toBe(400);
  });

  it('does not answer an empty timeline when the read fails', async () => {
    mocks.timeline.mockRejectedValue(new Error('connection reset'));
    const result = await call('GET');
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('entries');
  });

  it('serializes no field beyond the timeline contract', async () => {
    const result = await call('GET');
    const body = JSON.stringify(result.body);
    for (const forbidden of ['storageUrl', 'storageKey', 'originalFilename', 'note', 'metadata', 'latitude', 'longitude']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

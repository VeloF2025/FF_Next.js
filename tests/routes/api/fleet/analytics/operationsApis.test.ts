import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analytics: vi.fn(), drillDown: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/analytics/operationsAnalyticsService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/analytics/operationsAnalyticsService')>(
    '@/modules/fleet/incidents/analytics/operationsAnalyticsService',
  );
  return { ...actual, getOperationsAnalytics: mocks.analytics, getOperationsDrillDown: mocks.drillDown };
});

import analyticsHandler from '@/pages/api/fleet/analytics/operations';
import drillDownHandler from '@/pages/api/fleet/analytics/operations/drill-down';
import {
  OperationsAccessDeniedError, OperationsFilterConflictError,
} from '@/modules/fleet/incidents/analytics/operationsAnalyticsService';

/**
 * The gates ONE route registers, with nothing else in the recording.
 *
 * A single shared record cannot answer this question: both routes register the
 * same gate at import, so `toContainEqual` stays true when either one loses it.
 * Re-importing a single route into a fresh module registry is what makes the
 * two claims independent — and each route builds its gate once, at import, so
 * this is also the only place the registration can be observed.
 */
async function gatesRegisteredByAnalytics(): Promise<Array<[string, string]>> {
  vi.resetModules();
  mocks.gates.length = 0;
  await import('@/pages/api/fleet/analytics/operations');
  return [...mocks.gates];
}

async function gatesRegisteredByDrillDown(): Promise<Array<[string, string]>> {
  vi.resetModules();
  mocks.gates.length = 0;
  await import('@/pages/api/fleet/analytics/operations/drill-down');
  return [...mocks.gates];
}

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const DRIVER = '44444444-4444-4444-8444-444444444444';

const range = { op_start: '2026-01-01', op_end: '2026-03-31' };

const report = {
  filters: { start: '2026-01-01', end: '2026-03-31' }, metricVersion: 1,
  retainedDetailFrom: '2025-08-01', cards: [], series: [], suppressionNotices: [],
  freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
};

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
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
    method, query: options.query ?? range,
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue(STAFF);
  mocks.analytics.mockResolvedValue(report);
  mocks.drillDown.mockResolvedValue({ mode: 'retained_detail', values: [], incidentIds: [], nextCursor: null });
});

describe('GET /api/fleet/analytics/operations', () => {
  it('allows GET only', async () => {
    const result = await call(analyticsHandler, 'POST');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET');
  });

  it('gates on fleet.incidents view, on its own', async () => {
    expect(await gatesRegisteredByAnalytics()).toEqual([['fleet.incidents', 'view']]);
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call(analyticsHandler, 'GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('requires both ends of the range', async () => {
    const result = await call(analyticsHandler, 'GET', { query: { op_start: '2026-01-01' } });
    expect(result.status).toBe(400);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('refuses a malformed date, a bad enum, and a non-UUID', async () => {
    for (const query of [
      { ...range, op_start: 'January' },
      { ...range, op_type: 'sleeping' },
      { ...range, op_project: 'lawley' },
    ]) {
      expect((await call(analyticsHandler, 'GET', { query })).status).toBe(400);
    }
  });

  it('refuses a range wider than the limit', async () => {
    const result = await call(analyticsHandler, 'GET', { query: { op_start: '2020-01-01', op_end: '2026-01-01' } });
    expect(result.status).toBe(400);
  });

  it('passes each op_ filter through independently', async () => {
    await call(analyticsHandler, 'GET', { query: { ...range, op_project: PROJECT, op_type: 'late', op_evidence: 'false' } });
    expect(mocks.analytics).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, incidentType: 'late', evidenceAvailable: false }),
      { userId: USER, staffId: STAFF, role: 'manager' },
    );
  });

  it('does not read the queue own filter names', async () => {
    await call(analyticsHandler, 'GET', { query: { ...range, projectId: PROJECT } });
    expect(mocks.analytics).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectId: PROJECT }), expect.anything(),
    );
  });

  it('answers 403 for a project outside the viewer scope', async () => {
    mocks.analytics.mockRejectedValue(new OperationsAccessDeniedError('You cannot view analytics for that project'));
    expect((await call(analyticsHandler, 'GET')).status).toBe(403);
  });

  it('explains a driver filter that reaches past the retention boundary', async () => {
    mocks.analytics.mockRejectedValue(new OperationsFilterConflictError('op_driver and op_vehicle only apply to months at or after 2025-08-01'));
    const result = await call(analyticsHandler, 'GET', { query: { ...range, op_driver: DRIVER } });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toMatch(/2025-08-01/);
  });

  it('answers 500 on failure rather than an empty report that reads as zero', async () => {
    mocks.analytics.mockRejectedValue(new Error('connection reset'));
    const result = await call(analyticsHandler, 'GET');
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('"cards"');
  });

  it('serializes nothing outside the report contract', async () => {
    const result = await call(analyticsHandler, 'GET');
    const body = JSON.stringify(result.body);
    for (const forbidden of ['staffId', 'vehicleId', 'contributorKey', 'latitude', 'longitude', 'note']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('GET /api/fleet/analytics/operations/drill-down', () => {
  it('allows GET only', async () => {
    const result = await call(drillDownHandler, 'POST');
    expect(result.status).toBe(405);
  });

  it('gates on fleet.incidents view, on its own', async () => {
    expect(await gatesRegisteredByDrillDown()).toEqual([['fleet.incidents', 'view']]);
  });

  it('parses the filters with the same parser as the analytics endpoint', async () => {
    // Filter parity is the point: a drill-down that parsed op_ differently
    // would answer a different question than the card it was opened from.
    const result = await call(drillDownHandler, 'GET', { query: { ...range, op_type: 'sleeping' } });
    expect(result.status).toBe(400);
    expect(mocks.drillDown).not.toHaveBeenCalled();
  });

  it('forwards a cursor', async () => {
    await call(drillDownHandler, 'GET', { query: { ...range, cursor: 'abc' } });
    expect(mocks.drillDown).toHaveBeenCalledWith(expect.anything(), expect.anything(), { cursor: 'abc' });
  });

  it('refuses a repeated cursor', async () => {
    const result = await call(drillDownHandler, 'GET', { query: { ...range, cursor: ['a', 'b'] } });
    expect(result.status).toBe(400);
    expect(mocks.drillDown).not.toHaveBeenCalled();
  });

  it('returns aggregate_only as a normal answer, not an error', async () => {
    mocks.drillDown.mockResolvedValue({
      mode: 'aggregate_only',
      values: [{ metricKey: 'incident.late', numerator: 9, denominator: null, histogram: null, coverage: { months: 1, of: 1 } }],
      incidentIds: [], nextCursor: null,
    });
    const result = await call(drillDownHandler, 'GET');
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain('aggregate_only');
  });

  it('answers 500 on failure rather than an empty id list', async () => {
    mocks.drillDown.mockRejectedValue(new Error('connection reset'));
    const result = await call(drillDownHandler, 'GET');
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('incidentIds');
  });
});

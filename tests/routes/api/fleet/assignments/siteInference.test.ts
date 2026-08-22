import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level tests for the three site-inference endpoints.
 *
 * proposalScope.test.ts proves the redaction FUNCTION is correct; nothing there
 * proves a route calls it. That gap is what let an unscoped per-vehicle GET,
 * an unscoped revert, and a last-write-wins decision ship. These tests bind the
 * routes to those properties directly.
 */

const mocks = vi.hoisted(() => ({
  permission: true, calls: [] as Array<[string, string]>,
  list: vi.fn(), getProposal: vi.fn(), recordDecision: vi.fn(), recompute: vi.fn(),
  apply: vi.fn(), revert: vi.fn(), editScope: vi.fn(), authorizedIds: vi.fn(), staff: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
      async (req: NextApiRequest, res: NextApiResponse) => {
        mocks.calls.push([key, action]);
        return mocks.permission ? handler(req, res) : res.status(403).json({ success: false });
      },
}));
vi.mock('@/modules/fleet/assignments/inference/proposalQueries', () => ({
  listProposals: mocks.list, getProposal: mocks.getProposal,
}));
vi.mock('@/modules/fleet/assignments/inference/proposalRepository', () => ({
  recordDecision: mocks.recordDecision,
  InferenceDecisionError: class InferenceDecisionError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('@/modules/fleet/assignments/inference/inferenceService', () => ({
  recomputeProposals: mocks.recompute,
}));
vi.mock('@/modules/fleet/assignments/inference/applyService', () => ({
  applyProposal: mocks.apply, revertProposal: mocks.revert,
  ApplyProposalError: class ApplyProposalError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
  },
}));
vi.mock('@/modules/fleet/assignments/bulkAssignmentService', () => ({
  AssignmentServiceError: class AssignmentServiceError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
  },
}));
vi.mock('@/modules/fleet/assignments/projectScope', () => ({
  canEditAssignmentProject: mocks.editScope, authorizedAssignmentProjectIds: mocks.authorizedIds,
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));

import listHandler from '@/pages/api/fleet/assignments/site-inference/index';
import vehicleHandler from '@/pages/api/fleet/assignments/site-inference/[vehicleId]';
import applyHandler from '@/pages/api/fleet/assignments/site-inference/apply';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333333';
const THEIRS = '44444444-4444-4444-8444-444444444444';
const VEHICLE = '55555555-5555-4555-8555-555555555555';
const DECIDED_AT = '2026-08-21T10:00:00.000Z';
const REVISION = 3;

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: VEHICLE, registration: 'MW94RBGP', outcome: 'confident',
    inferredProjectId: MINE, inferredProjectName: 'Lawley', dominantShare: 0.84,
    pings: 100, dwellSeconds: 1000, distinctDays: 10, totalPositions: 120,
    windowStart: '2026-07-17T00:00:00.000Z', windowEnd: '2026-08-21T00:00:00.000Z',
    breakdown: [
      { projectId: MINE, projectName: 'Lawley', pings: 84, dwellSeconds: 840, distinctDays: 10, share: 0.84 },
      { projectId: THEIRS, projectName: 'Mohadin', pings: 16, dwellSeconds: 160, distinctDays: 3, share: 0.16 },
    ],
    computedAt: '2026-08-21T00:00:00.000Z', decision: null, decidedProjectId: null,
    decidedProjectName: null, decidedFrom: null, note: null, decidedBy: null, decidedAt: null,
    decisionRevision: null,
    decisionMatchesInference: null, effectiveProjectId: MINE, appliedAssignmentId: null,
    appliedAt: null, drivers: [],
    ...overrides,
  };
}

interface CallState { status: number; body: unknown; headers: Record<string, string> }

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method: string,
  options: { query?: Record<string, string>; body?: unknown; role?: string } = {},
): Promise<CallState> {
  const state: CallState = { status: 200, body: undefined, headers: {} };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  await handler({
    method, query: options.query ?? {}, body: options.body,
    user: { id: USER, role: options.role ?? 'manager' },
  } as unknown as NextApiRequest, res);
  return state;
}

function data(state: CallState): Record<string, unknown> {
  return (state.body as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission = true; mocks.calls.length = 0;
  mocks.staff.mockResolvedValue(STAFF);
  mocks.editScope.mockResolvedValue(true);
  mocks.authorizedIds.mockResolvedValue([MINE]);
  mocks.list.mockResolvedValue([proposal()]);
  mocks.getProposal.mockResolvedValue(proposal());
  mocks.recordDecision.mockResolvedValue(undefined);
  mocks.recompute.mockResolvedValue({
    window: { start: new Date(0), end: new Date(1) }, results: [],
    counts: { confident: 0, roaming: 0, insufficient_data: 0, no_aoi_coverage: 0 },
  });
  mocks.apply.mockResolvedValue({ vehicleId: VEHICLE, assignmentId: 'a-1' });
  mocks.revert.mockResolvedValue(undefined);
});

describe('site-inference list route', () => {
  it('requires the fleet assignment permission and allows GET/POST only', async () => {
    const method = await call(listHandler, 'PUT');
    expect(method.status).toBe(405);
    expect(mocks.calls).toEqual([]);
    mocks.permission = false;
    expect((await call(listHandler, 'GET')).status).toBe(403);
    expect(mocks.calls).toEqual([['fleet.assignments', 'view']]);
  });

  it('redacts projects outside the caller scope', async () => {
    const state = await call(listHandler, 'GET');
    const rows = (state.body as { data: Array<{ breakdown: Array<{ projectId: string }> }> }).data;
    expect(rows[0].breakdown.map((entry) => entry.projectId)).toEqual([MINE]);
  });

  it('lets an admin see every project in the breakdown', async () => {
    const state = await call(listHandler, 'GET', { role: 'admin' });
    const rows = (state.body as { data: Array<{ breakdown: Array<{ projectId: string }> }> }).data;
    expect(rows[0].breakdown.map((entry) => entry.projectId)).toEqual([MINE, THEIRS]);
  });

  it('refuses a recompute from a non-admin', async () => {
    expect((await call(listHandler, 'POST', { body: {} })).status).toBe(403);
    expect(mocks.recompute).not.toHaveBeenCalled();
  });
});

describe('site-inference per-vehicle route', () => {
  it('redacts a project the caller cannot see rather than returning it raw', async () => {
    const state = await call(vehicleHandler, 'GET', { query: { vehicleId: VEHICLE } });
    expect(state.status).toBe(200);
    const row = data(state);
    expect(row.breakdown).toHaveLength(1);
    expect((row.breakdown as Array<{ projectId: string }>)[0].projectId).toBe(MINE);
  });

  it('does not disclose a proposal whose projects are all outside the caller scope', async () => {
    mocks.getProposal.mockResolvedValue(proposal({
      inferredProjectId: THEIRS, inferredProjectName: 'Mohadin', effectiveProjectId: THEIRS,
      breakdown: [{ projectId: THEIRS, projectName: 'Mohadin', pings: 100, dwellSeconds: 1000, distinctDays: 10, share: 1 }],
    }));
    const state = await call(vehicleHandler, 'GET', { query: { vehicleId: VEHICLE } });
    expect(state.status).toBe(404);
    expect(JSON.stringify(state.body)).not.toContain('Mohadin');
  });

  it('refuses to decide a proposal on a project the caller cannot edit', async () => {
    mocks.editScope.mockResolvedValue(false);
    const state = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE }, body: { decision: 'assigned' },
    });
    expect(state.status).toBe(403);
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a decision made for a project the caller cannot edit', async () => {
    // The proposal's INFERRED project is in scope, but another person already
    // decided it onto a project that is not. Checking only the new project lets
    // that decision be taken over without ever being seen.
    mocks.getProposal.mockResolvedValue(proposal({
      decision: 'assigned', decidedProjectId: THEIRS, decidedProjectName: 'Mohadin',
      decidedFrom: 'override', decidedAt: DECIDED_AT, decisionRevision: REVISION,
      effectiveProjectId: THEIRS,
    }));
    mocks.editScope.mockImplementation(async (_u, _s, _r, projectId: string) => projectId === MINE);
    const state = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE },
      body: { decision: 'assigned', expectedRevision: REVISION },
    });
    expect(state.status).toBe(403);
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it('answers an out-of-scope caller with 403 before telling them the row is stale', async () => {
    // Ordering matters: a 409 naming a revision would confirm to someone with no
    // access that a decision exists and how far along it is.
    mocks.getProposal.mockResolvedValue(proposal({
      decision: 'assigned', decidedProjectId: MINE, decidedFrom: 'inference',
      decidedAt: DECIDED_AT, decisionRevision: REVISION,
    }));
    mocks.editScope.mockResolvedValue(false);
    const state = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE },
      body: { decision: 'rejected', expectedRevision: REVISION - 1 },
    });
    expect(state.status).toBe(403);
    expect(JSON.stringify(state.body)).not.toContain('stale_decision');
  });

  it('rejects a decision written against a revision the caller did not read', async () => {
    mocks.getProposal.mockResolvedValue(proposal({
      decision: 'assigned', decidedProjectId: MINE, decidedFrom: 'inference',
      decidedAt: DECIDED_AT, decisionRevision: REVISION,
    }));
    const stale = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE },
      body: { decision: 'rejected', expectedRevision: REVISION - 1 },
    });
    expect(stale.status).toBe(409);
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it('rejects a first decision that omits expectedRevision when one already exists', async () => {
    mocks.getProposal.mockResolvedValue(proposal({
      decision: 'assigned', decidedProjectId: MINE, decidedFrom: 'inference',
      decidedAt: DECIDED_AT, decisionRevision: REVISION,
    }));
    const blind = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE }, body: { decision: 'rejected' },
    });
    expect(blind.status).toBe(409);
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it('forwards the read revision so the write is conditional at the database too', async () => {
    mocks.getProposal.mockResolvedValue(proposal({
      decision: 'assigned', decidedProjectId: MINE, decidedFrom: 'inference',
      decidedAt: DECIDED_AT, decisionRevision: REVISION,
    }));
    await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE },
      body: { decision: 'rejected', expectedRevision: REVISION },
    });
    expect(mocks.recordDecision).toHaveBeenCalledWith(
      VEHICLE, expect.objectContaining({ expectedRevision: REVISION }), USER);
  });

  it('redacts the row it echoes back after a decision', async () => {
    mocks.getProposal.mockResolvedValue(proposal());
    const state = await call(vehicleHandler, 'PATCH', {
      query: { vehicleId: VEHICLE }, body: { decision: 'assigned' },
    });
    expect(state.status).toBe(200);
    expect((data(state).breakdown as unknown[])).toHaveLength(1);
  });
});

describe('site-inference apply route', () => {
  it('refuses to revert a proposal on a project the caller cannot edit', async () => {
    mocks.editScope.mockResolvedValue(false);
    const state = await call(applyHandler, 'DELETE', {
      body: { vehicleId: VEHICLE, endDate: '2026-08-21' },
    });
    expect(state.status).toBe(403);
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it('refuses to apply a proposal on a project the caller cannot edit', async () => {
    mocks.editScope.mockResolvedValue(false);
    const state = await call(applyHandler, 'POST', {
      body: { vehicleId: VEHICLE, startDate: '2026-08-01', endDate: '2026-08-31' },
    });
    expect(state.status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('surfaces no_site_for_project as a 409 and applies nothing', async () => {
    const { ApplyProposalError } = await import(
      '@/modules/fleet/assignments/inference/applyService');
    mocks.apply.mockRejectedValue(new ApplyProposalError(
      'no_site_for_project', 'That project has no active operational site.', 409));
    const state = await call(applyHandler, 'POST', {
      body: { vehicleId: VEHICLE, startDate: '2026-08-01', endDate: '2026-08-31' },
    });
    expect(state.status).toBe(409);
    expect(JSON.stringify(state.body)).toContain('no active operational site');
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it('rejects malformed dates before reaching the service', async () => {
    expect((await call(applyHandler, 'POST', {
      body: { vehicleId: VEHICLE, startDate: '2026-8-1', endDate: '2026-08-31' } })).status).toBe(400);
    expect((await call(applyHandler, 'POST', {
      body: { vehicleId: VEHICLE, startDate: '2026-09-01', endDate: '2026-08-31' } })).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

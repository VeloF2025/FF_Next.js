/**
 * The PR8 analytics/retention settings surface.
 *
 * Two properties carry most of the weight: reading and writing are gated
 * differently, and the actor recorded against a change is the SESSION, never
 * anything the request body claims.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effective: vi.fn(), version: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => {
    mocks.gates.push([key, action]);
    return handler;
  },
}));
vi.mock('@/modules/fleet/incidents/analytics/settingsRepository', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/analytics/settingsRepository')>(
    '@/modules/fleet/incidents/analytics/settingsRepository',
  );
  return {
    ...actual,
    getEffectiveAnalyticsRetentionSettings: mocks.effective,
    versionAnalyticsRetentionSettings: mocks.version,
  };
});

import handler from '@/pages/api/fleet/incidents/settings/retention-analytics';
import { RetentionSettingsValidationError } from '@/modules/fleet/incidents/analytics/settingsRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const POLICY = {
  version: 4, effectiveFrom: '2026-01-01T00:00:00.000Z', retentionMonths: 12,
  anonymityMinContributors: 5, recalculationWindowMonths: 3, retentionBatchSize: 100,
  maximumHoldReviewDays: 90, holdReviewReminderLeadDays: 14,
  aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
  retentionRunHourSast: 3, retentionRunMinuteSast: 30,
  aggregateFreshnessWarningHours: 36, retentionFreshnessWarningHours: 48,
  permittedHoldCategories: ['legal'], metricVersion: 1, liveRetentionEnabled: false,
};

/** A complete, valid POST body. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    retentionMonths: 12, anonymityMinContributors: 5, recalculationWindowMonths: 3,
    retentionBatchSize: 100, maximumHoldReviewDays: 90, holdReviewReminderLeadDays: 14,
    aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
    retentionRunHourSast: 3, retentionRunMinuteSast: 30,
    aggregateFreshnessWarningHours: 36, retentionFreshnessWarningHours: 48,
    permittedHoldCategories: ['legal'], metricVersion: 1, liveRetentionEnabled: false,
    changeReason: 'Quarterly review',
    ...over,
  };
}

async function call(method: string, options: { body?: unknown; user?: { id: string; role: string } | null } = {}) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: {}, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gates.length = 0;
  mocks.effective.mockResolvedValue(POLICY);
  mocks.version.mockResolvedValue({ ...POLICY, version: 5 });
});

describe('/api/fleet/incidents/settings/retention-analytics', () => {
  it('allows GET and POST only', async () => {
    const result = await call('DELETE');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET, POST');
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call('GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.effective).not.toHaveBeenCalled();
  });

  it('returns the effective policy on GET', async () => {
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain('"retentionMonths":12');
  });

  /**
   * Reading the policy and changing it are different privileges: a PM needs to
   * know how long detail is kept, and must not be able to shorten it.
   */
  it('gates reading on view and writing on edit', async () => {
    await call('GET');
    expect(mocks.gates).toEqual([['fleet.incidents-settings', 'view']]);

    mocks.gates.length = 0;
    await call('POST', { body: body() });
    expect(mocks.gates).toEqual([['fleet.incidents-settings', 'edit']]);
  });

  it('versions the policy on POST', async () => {
    const result = await call('POST', { body: body() });
    expect(result.status).toBe(201);
    expect(mocks.version).toHaveBeenCalledWith(
      expect.objectContaining({ retentionMonths: 12, permittedHoldCategories: ['legal'] }), USER,
    );
  });

  /**
   * The actor is the session. A body that names someone else must not be able
   * to attribute a retention change to them.
   */
  it('records the session actor, ignoring any actor named in the body', async () => {
    await call('POST', { body: body({ actorUserId: OTHER, createdBy: OTHER }) });
    expect(mocks.version).toHaveBeenLastCalledWith(expect.anything(), USER);
    expect(JSON.stringify(mocks.version.mock.calls.at(-1)?.[0])).not.toContain(OTHER);
  });

  it('refuses a body that is not an object', async () => {
    for (const bad of [undefined, null, 'settings', []]) {
      const result = await call('POST', { body: bad });
      expect(result.status).toBe(400);
    }
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it.each([
    ['retentionMonths', { retentionMonths: 'twelve' }],
    ['effectiveFrom', { effectiveFrom: 12 }],
    ['permittedHoldCategories', { permittedHoldCategories: 'legal' }],
    ['a category that is not a string', { permittedHoldCategories: [7] }],
    ['liveRetentionEnabled', { liveRetentionEnabled: 'no' }],
    ['acknowledgedDryRunId', { acknowledgedDryRunId: 7 }],
  ])('refuses a malformed %s', async (_label, over) => {
    const result = await call('POST', { body: body(over) });
    expect(result.status).toBe(400);
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it('passes an acknowledged dry run through to the repository', async () => {
    const dryRun = '99999999-9999-4999-8999-999999999999';
    await call('POST', { body: body({ retentionMonths: 6, acknowledgedDryRunId: dryRun }) });
    expect(mocks.version).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgedDryRunId: dryRun }), USER,
    );
  });

  /**
   * The repository's rules reach the caller as a 400 with their own words —
   * "shorten from 12 to 6 months" is actionable, "Internal server error" is not.
   */
  it('reports a settings rule as a bad request, in its own words', async () => {
    mocks.version.mockRejectedValue(new RetentionSettingsValidationError(
      'Shortening retention from 12 to 6 months makes more incidents deletable at the next purge.',
    ));
    const result = await call('POST', { body: body({ retentionMonths: 6 }) });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('12 to 6 months');
  });

  it('answers 500 on an unexpected failure without echoing a policy', async () => {
    mocks.version.mockRejectedValue(new Error('connection reset'));
    const result = await call('POST', { body: body() });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('retentionMonths');
  });
});

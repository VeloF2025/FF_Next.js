/**
 * The export endpoint's whole job is to be the same request as
 * `/api/fleet/analytics/operations` with a different Accept. These tests are
 * about that parity, and about the one way a download can lie that a JSON
 * response cannot: returning 200 with a well-formed but empty workbook when the
 * query behind it actually failed.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analytics: vi.fn(), workbook: vi.fn(), staff: vi.fn(), scope: vi.fn(), settings: vi.fn(),
  gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
// Spread over the real modules rather than replaced: `operationsScope` imports
// other names from both, and a bare factory would leave those undefined at
// import time — a failure about the mock, not about the route.
vi.mock('@/modules/fleet/incidents/reviewScope', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/reviewScope')>(
    '@/modules/fleet/incidents/reviewScope',
  );
  return { ...actual, resolveIncidentScope: mocks.scope };
});
vi.mock('@/modules/fleet/incidents/analytics/settingsRepository', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/analytics/settingsRepository')>(
    '@/modules/fleet/incidents/analytics/settingsRepository',
  );
  return { ...actual, getEffectiveAnalyticsRetentionSettings: mocks.settings };
});
vi.mock('@/modules/fleet/incidents/analytics/operationsWorkbook', () => ({
  buildOperationsWorkbook: mocks.workbook,
}));
vi.mock('@/modules/fleet/incidents/analytics/operationsAnalyticsService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/analytics/operationsAnalyticsService')>(
    '@/modules/fleet/incidents/analytics/operationsAnalyticsService',
  );
  return { ...actual, getOperationsAnalytics: mocks.analytics };
});

import exportHandler from '@/pages/api/fleet/analytics/operations/export';
import {
  OperationsAccessDeniedError, OperationsFilterConflictError,
} from '@/modules/fleet/incidents/analytics/operationsAnalyticsService';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const range = { op_start: '2026-01-01', op_end: '2026-03-31' };

const report = {
  filters: { start: '2026-01-01', end: '2026-03-31' }, metricVersion: 1,
  retainedDetailFrom: '2025-08-01', cards: [], series: [], suppressionNotices: [],
  freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
};

/** The gates this route registers, in a module registry nothing else has touched. */
async function gatesRegistered(): Promise<Array<[string, string]>> {
  vi.resetModules();
  mocks.gates.length = 0;
  await import('@/pages/api/fleet/analytics/operations/export');
  return [...mocks.gates];
}

async function call(
  method: string,
  options: { query?: Record<string, string | string[]>; user?: { id: string; role: string } | null } = {},
) {
  const state = {
    status: 200, body: undefined as unknown, headers: {} as Record<string, string>,
    ended: undefined as unknown,
  };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
    end(value?: unknown) { state.ended = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: options.query ?? range,
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await exportHandler(req, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue(STAFF);
  mocks.analytics.mockResolvedValue(report);
  mocks.workbook.mockResolvedValue(Buffer.from('xlsx-bytes'));
  mocks.scope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
  mocks.settings.mockResolvedValue({ anonymityMinContributors: 5 });
});

describe('GET /api/fleet/analytics/operations/export', () => {
  it('allows GET only', async () => {
    const result = await call('POST');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET');
  });

  it('gates on fleet.incidents view, on its own', async () => {
    expect(await gatesRegistered()).toEqual([['fleet.incidents', 'view']]);
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call('GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  /**
   * Parity with the screen is the whole point of reusing the parser: an export
   * that accepted a filter the analytics endpoint refuses would answer a
   * question nobody could have asked on screen.
   */
  it('refuses what the analytics endpoint refuses, in the same words', async () => {
    for (const query of [
      { ...range, op_type: 'sleeping' },
      { ...range, op_project: 'lawley' },
      { ...range, op_sevrity: 'high' },
      { op_start: '2026-01-01' },
    ]) {
      const result = await call('GET', { query });
      expect(result.status).toBe(400);
    }
    expect(mocks.analytics).not.toHaveBeenCalled();
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  it('asks the service the same question the screen asks', async () => {
    await call('GET', { query: { ...range, op_project: PROJECT, op_evidence: 'false' } });
    expect(mocks.analytics).toHaveBeenCalledWith(
      expect.objectContaining({
        start: '2026-01-01', end: '2026-03-31', projectId: PROJECT, evidenceAvailable: false,
      }),
      { userId: USER, staffId: STAFF, role: 'manager' },
    );
  });

  it('builds the workbook from the service response, never from the query', async () => {
    await call('GET');
    expect(mocks.workbook).toHaveBeenCalledWith(report, expect.any(Object));
  });

  it('sends the workbook as a download named for the range', async () => {
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(result.headers['Content-Type'])
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.headers['Content-Disposition']).toContain('attachment');
    expect(result.headers['Content-Disposition']).toContain('2026-01-01');
    expect(result.headers['Content-Disposition']).toContain('2026-03-31');
    expect(result.ended).toEqual(Buffer.from('xlsx-bytes'));
  });

  it('records the viewer scope on the file so a reader knows what it covers', async () => {
    await call('GET');
    expect(mocks.workbook).toHaveBeenCalledWith(report, expect.objectContaining({
      scopeLabel: expect.stringMatching(/manage/i),
    }));

    mocks.scope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF });
    await call('GET');
    expect(mocks.workbook).toHaveBeenLastCalledWith(report, expect.objectContaining({
      scopeLabel: expect.stringMatching(/all projects/i),
    }));
  });

  it('takes the anonymity threshold from the settings rather than restating it', async () => {
    mocks.settings.mockResolvedValue({ anonymityMinContributors: 7 });
    await call('GET');
    expect(mocks.workbook).toHaveBeenCalledWith(report, expect.objectContaining({
      anonymityMinContributors: 7,
    }));
  });

  it('answers 403 for a project outside the viewer scope', async () => {
    mocks.analytics.mockRejectedValue(new OperationsAccessDeniedError('You cannot view analytics for that project'));
    const result = await call('GET');
    expect(result.status).toBe(403);
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  it('explains a filter conflict rather than exporting the half it could answer', async () => {
    mocks.analytics.mockRejectedValue(new OperationsFilterConflictError('op_driver only applies to retained months'));
    const result = await call('GET');
    expect(result.status).toBe(400);
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  it('refuses to serve a workbook when the viewer lost the scope behind the gate', async () => {
    mocks.scope.mockResolvedValue(null);
    const result = await call('GET');
    expect(result.status).toBe(403);
    expect(mocks.workbook).not.toHaveBeenCalled();
  });

  /**
   * The failure mode a download has and a JSON response does not: a spreadsheet
   * with headings and no rows is indistinguishable from a period in which
   * nothing happened. So a failure must not reach the browser wearing a
   * spreadsheet's content type.
   */
  it('answers 500 as JSON rather than an empty workbook', async () => {
    mocks.analytics.mockRejectedValue(new Error('connection reset'));
    const result = await call('GET');
    expect(result.status).toBe(500);
    expect(result.headers['Content-Type']).toBeUndefined();
    expect(result.headers['Content-Disposition']).toBeUndefined();
    expect(result.ended).toBeUndefined();
  });

  it('answers 500 when the workbook itself fails, with no partial download', async () => {
    mocks.workbook.mockRejectedValue(new Error('exceljs blew up'));
    const result = await call('GET');
    expect(result.status).toBe(500);
    expect(result.headers['Content-Type']).toBeUndefined();
    expect(result.ended).toBeUndefined();
  });
});

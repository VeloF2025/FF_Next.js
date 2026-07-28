/**
 * /api/billing/status reports every metric anchored to each project's OWN
 * latest billing week. When a project misses a week (e.g. FT never shipped its
 * payment PDF) its numbers keep reading as current while silently describing an
 * older week, and the aggregate `totals` quietly under-count it.
 *
 * These tests pin the staleness signal that makes that visible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
}));

import handler from '../status';

interface StatusPayload {
  projects: { project: string; latest_week_ending: string | null; weeks_behind: number }[];
  newest_week_ending: string | null;
  stale: { project: string; latest_week_ending: string | null; weeks_behind: number }[];
}

function makeRes() {
  const res: Partial<NextApiResponse> & { jsonData?: { data?: StatusPayload } } = {};
  res.status = vi.fn(() => res as NextApiResponse);
  res.json = vi.fn((data: unknown) => {
    res.jsonData = data as { data?: StatusPayload };
    return res as NextApiResponse;
  });
  return res as NextApiResponse & { jsonData?: { data?: StatusPayload } };
}

/**
 * Route each query by its SQL shape. `latestWeekByProject` decides what each
 * project's own most-recent billing week is; everything else returns zeros so
 * the test isolates the staleness computation.
 */
function stubDb(projects: string[], latestWeekByProject: Record<string, string>, newest: string) {
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT DISTINCT project')) {
      return Promise.resolve({ rows: projects.map((p) => ({ project: p })) });
    }
    if (sql.includes('MAX(week_ending)')) {
      return Promise.resolve({ rows: [{ newest }] });
    }
    if (sql.includes('ORDER BY week_ending DESC') && sql.includes('LIMIT 1') && !sql.includes('COUNT')) {
      const proj = String(params?.[0]);
      return Promise.resolve({ rows: [{ week_ending: latestWeekByProject[proj] }] });
    }
    return Promise.resolve({ rows: [{ count: '0' }] });
  });
}

async function call(query: Record<string, string> = {}) {
  const res = makeRes();
  await (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(
    { method: 'GET', query } as unknown as NextApiRequest,
    res,
  );
  return res.jsonData?.data;
}

describe('GET /api/billing/status — stale billing week signal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flags a project whose latest week trails the newest week', async () => {
    stubDb(
      ['Lawley', 'Thembisa POP 3'],
      { Lawley: '2026-07-26', 'Thembisa POP 3': '2026-07-19' },
      '2026-07-26',
    );

    const data = await call();

    expect(mockQuery).toHaveBeenCalled(); // mock actually replaced the module
    expect(data?.newest_week_ending).toBe('2026-07-26');
    expect(data?.stale).toEqual([
      { project: 'Thembisa POP 3', latest_week_ending: '2026-07-19', weeks_behind: 1 },
    ]);
    expect(data?.projects.find((p) => p.project === 'Lawley')?.weeks_behind).toBe(0);
  });

  it('reports an empty stale list when every project is on the newest week', async () => {
    stubDb(
      ['Lawley', 'Mohadin'],
      { Lawley: '2026-07-26', Mohadin: '2026-07-26' },
      '2026-07-26',
    );

    const data = await call();

    expect(data?.stale).toEqual([]);
    expect(data?.projects.every((p) => p.weeks_behind === 0)).toBe(true);
  });

  // The trap this guards: if the newest-week query inherited the ?project
  // filter, a stale project viewed on its own would compare against itself and
  // always read 0 weeks behind — hiding the gap exactly when you drilled in.
  it('still detects staleness when the view is filtered to the stale project', async () => {
    stubDb(['Thembisa POP 3'], { 'Thembisa POP 3': '2026-07-19' }, '2026-07-26');

    const data = await call({ project: 'Thembisa POP 3' });

    expect(data?.stale).toHaveLength(1);
    expect(data?.stale[0]?.weeks_behind).toBe(1);

    // Assert directly that the frontier query carried no bind parameters.
    const frontierCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('MAX(week_ending)'));
    expect(frontierCall).toBeDefined();
    expect(frontierCall?.[1]).toBeUndefined();
  });

  it('counts multi-week gaps in whole weeks', async () => {
    stubDb(
      ['Lawley', 'Mamelodi'],
      { Lawley: '2026-07-26', Mamelodi: '2026-06-28' },
      '2026-07-26',
    );

    const data = await call();

    expect(data?.stale[0]).toEqual({
      project: 'Mamelodi',
      latest_week_ending: '2026-06-28',
      weeks_behind: 4,
    });
  });

  it('returns a well-formed empty payload when no project has billed', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const data = await call();

    expect(data?.stale).toEqual([]);
    expect(data?.newest_week_ending).toBeNull();
  });
});

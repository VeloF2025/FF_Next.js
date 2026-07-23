/**
 * H&S dashboard — the configured-projects metric must count the population it names.
 *
 * Regression guard for the 2026-07-24 Phase 0 fix: `total_projects_configured`
 * was a bare `COUNT(*) FROM hs_project_config`, so it reported 8 while only 5
 * projects were configured — it counted deactivated rows and rows whose project
 * had been deleted, neither of which the overdue/upcoming lists beside it can
 * ever show.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'admin@velocityfibre.co.za' })),
}));

import handler from '../../../../pages/api/health-safety/dashboard';

/** Flatten a tagged-template call back into inspectable SQL text. */
function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ').trim();
}

function findQuery(match: RegExp): string | undefined {
  return sqlMock.mock.calls.map(q).find((text) => match.test(text));
}

/**
 * Several dashboard queries select `COUNT(*)::int as count`; the configured-
 * projects one is identified by the table it counts, not by its projection.
 */
const CONFIGURED_PROJECTS_QUERY = /COUNT\(\*\)::int as count FROM hs_project_config/;
const OVERDUE_QUERY = /next_audit_due < NOW\(\)/;

describe('GET /api/health-safety/dashboard — configured-projects metric', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every query in the handler resolves to an empty result set except the
    // ones whose shape the handler indexes into directly.
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join(' ');
      if (text.includes('information_schema.tables')) return Promise.resolve([{ exists: false }]);
      if (text.includes('COUNT(*)::int as count')) return Promise.resolve([{ count: 5 }]);
      return Promise.resolve([]);
    });
  });

  async function run() {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });
    await handler(req, res);
    return res;
  }

  it('constrains the count to active configs on projects that still exist', async () => {
    await run();

    const countQuery = findQuery(CONFIGURED_PROJECTS_QUERY);
    expect(countQuery).toBeDefined();

    // A bare COUNT(*) over hs_project_config is the bug being guarded against.
    expect(countQuery).toMatch(/JOIN projects p ON p\.id = pc\.project_id/);
    expect(countQuery).toMatch(/pc\.is_active = true/);
  });

  it('draws the count from the same population as the overdue list', async () => {
    await run();

    const countQuery = findQuery(CONFIGURED_PROJECTS_QUERY);
    const overdueQuery = findQuery(OVERDUE_QUERY);
    expect(countQuery).toBeDefined();
    expect(overdueQuery).toBeDefined();

    // Both must join projects and filter is_active, or the denominator can
    // exceed anything the list is able to display.
    for (const text of [countQuery, overdueQuery]) {
      expect(text).toMatch(/JOIN projects/);
      expect(text).toMatch(/is_active = true/);
    }
  });

  it('reports the queried value as total_projects_configured', async () => {
    const res = await run();

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data.overall.total_projects_configured).toBe(5);
  });
});

/**
 * Tests for GET /api/field/users — source + declared project columns.
 *
 * Asserts that every filter branch (both / role-only / accountStatus-only / neither)
 * issues a SELECT that includes `s.source`, `s.declared_project_id`, and
 * `p.project_name AS declared_project_name` via a LEFT JOIN on projects.
 *
 * Why SQL-shape assertions?
 *   The handler builds all SELECT branches inline (Neon shim limitation —
 *   conditional SQL fragments cannot be composed). Each branch must be updated
 *   independently, so we verify the generated query text rather than just the
 *   passthrough response value.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks before any imports ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
}));

// ── Handler import (after mocks are hoisted) ─────────────────────────────────

import handler from '../../../../pages/api/field/users/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(query: Record<string, string> = {}, method = 'GET'): NextApiRequest {
  return {
    method,
    query,
    headers: {},
    socket: {},
    body: {},
    // Provide a user stub so the PERMITTED_AUTH_ROLES gate passes
    user: { id: 'u1', role: 'admin' },
  } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

/**
 * Extract the raw SQL string from a tagged-template sql mock call.
 * Vitest captures `sql\`...\`` as: calls[n][0] = TemplateStringsArray (the string parts joined).
 */
function capturedSql(callIndex = 0): string {
  const rawParts = mocks.sql.mock.calls[callIndex]?.[0] as TemplateStringsArray | undefined;
  if (!rawParts) throw new Error(`No sql call at index ${callIndex}`);
  // Join raw parts with a placeholder to reassemble the query shape
  return Array.from(rawParts).join('$?');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sql.mockResolvedValue([]);
});

describe('GET /api/field/users — source + declared project columns in SQL', () => {
  it('branch: both role + accountStatus — SELECT includes source, declared_project_id, declared_project_name', async () => {
    const { res } = makeRes();
    await handler(makeReq({ role: 'technician', accountStatus: 'pending' }), res);

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = capturedSql();
    expect(query).toContain('s.source');
    expect(query).toContain('s.declared_project_id');
    expect(query).toContain('declared_project_name');
    expect(query).toContain('LEFT JOIN projects');
  });

  it('branch: role-only filter — SELECT includes source, declared_project_id, declared_project_name', async () => {
    const { res } = makeRes();
    await handler(makeReq({ role: 'technician' }), res);

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = capturedSql();
    expect(query).toContain('s.source');
    expect(query).toContain('s.declared_project_id');
    expect(query).toContain('declared_project_name');
    expect(query).toContain('LEFT JOIN projects');
  });

  it('branch: accountStatus-only filter — SELECT includes source, declared_project_id, declared_project_name', async () => {
    const { res } = makeRes();
    await handler(makeReq({ accountStatus: 'pending' }), res);

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = capturedSql();
    expect(query).toContain('s.source');
    expect(query).toContain('s.declared_project_id');
    expect(query).toContain('declared_project_name');
    expect(query).toContain('LEFT JOIN projects');
  });

  it('branch: no filter — SELECT includes source, declared_project_id, declared_project_name', async () => {
    const { res } = makeRes();
    await handler(makeReq({}), res);

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const query = capturedSql();
    expect(query).toContain('s.source');
    expect(query).toContain('s.declared_project_id');
    expect(query).toContain('declared_project_name');
    expect(query).toContain('LEFT JOIN projects');
  });

  it('branch: no filter — staff table is aliased as s', async () => {
    const { res } = makeRes();
    await handler(makeReq({}), res);

    const query = capturedSql();
    expect(query).toContain('FROM staff s');
  });

  it('response passes new columns through to the caller', async () => {
    const staffRow = {
      id: 'sf-1',
      first_name: 'Thabo',
      last_name: 'M',
      phone: '0821234567',
      email: 'thabo@phone.local',
      role: 'technician',
      account_status: 'pending',
      created_by_staff_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      source: 'self_registration',
      declared_project_id: 'proj-42',
      declared_project_name: 'Thembelihle Phase 3',
    };
    mocks.sql.mockResolvedValue([staffRow]);

    const { res, captured } = makeRes();
    await handler(makeReq({ accountStatus: 'pending' }), res);

    expect(captured.statusCode).toBe(200);
    const rows = (captured.body as { data: typeof staffRow[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'self_registration',
      declared_project_id: 'proj-42',
      declared_project_name: 'Thembelihle Phase 3',
    });
  });
});

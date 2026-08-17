/**
 * The attendance ROUTE's scope wiring, driven end to end.
 *
 * The library that applies supervisor scope is thoroughly tested. The two lines that pass
 * the scope INTO it were not, so reverting them — `attendanceQuery(filter, null)` instead
 * of `attendanceQuery(filter, scope.allowedStaffIds)` — left every suite green while
 * handing a supervisor the whole workforce. That is the exact defect the fix exists to
 * close, and it was the only mutation to survive.
 *
 * So these call the shipped default export and assert on the ROWS a scoped caller gets.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { NextApiRequest, NextApiResponse } from 'next';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

/** Set per test to whatever the scope resolver should return. */
let currentScope: { allowedStaffIds: string[] | null; note: { kind: string; staffCount?: number } };

// Only the scope RESOLVER is stubbed — deciding who supervises whom is a different
// module with its own tests. Everything the route does with the answer is real.
vi.mock('@/services/attendance/searchQueries', () => ({
  resolveScope: vi.fn(async () => currentScope),
}));

// Authentication is not what these assert; the permission wrapper is exercised by its
// own suite. What matters here is that the handler applies the resolved scope.
vi.mock('@/lib/auth/middleware', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

interface Captured {
  status: number;
  body: unknown;
}

function mockRes(): { res: NextApiResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    send(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader() {},
    end() {
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, captured };
}

function req(query: Record<string, string>): NextApiRequest {
  return {
    method: 'GET',
    query,
    headers: {},
    user: { id: 'u1', email: 'u1@example.com', role: 'manager' },
  } as unknown as NextApiRequest;
}

/** The names in the response, whatever envelope apiResponse wraps it in. */
function namesFrom(body: unknown): string[] {
  const data = (body as { data?: { days?: Array<{ name: string }> } })?.data;
  return [...new Set((data?.days ?? []).map((d) => d.name))].sort();
}

describe('attendance route — scope wiring (real Postgres)', () => {
  let pool: Pool;
  let handler: (r: NextApiRequest, s: NextApiResponse) => Promise<unknown>;

  beforeAll(async () => {
    vi.stubEnv(
      'DATABASE_URL',
      `${process.env.DATABASE_URL_TEST ?? ''}?options=-c%20search_path%3Datt_route,public`,
    );
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=att_route,public',
    });

    await pool.query(`
      DROP SCHEMA IF EXISTS att_route CASCADE;
      CREATE SCHEMA att_route;
      CREATE TABLE att_route.staff (
        id UUID PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT, role TEXT, status TEXT
      );
      CREATE TABLE att_route.attendance_daily_summaries (
        staff_id UUID, work_date DATE,
        regular_hrs NUMERIC(5,2), overtime_hrs NUMERIC(5,2),
        sunday_hrs NUMERIC(5,2), holiday_hrs NUMERIC(5,2), result_status TEXT
      );
      CREATE TABLE att_route.attendance_day_exceptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID, work_date DATE, kind TEXT, status TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      INSERT INTO att_route.staff (id, name, status) VALUES
        ('${ALICE}', 'Alice Supervised', 'active'),
        ('${BOB}',   'Bob Elsewhere',    'active');
      INSERT INTO att_route.attendance_daily_summaries
        (staff_id, work_date, regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, result_status) VALUES
        ('${ALICE}','2026-08-10', 8, 0, 0, 0, 'approved'),
        ('${BOB}',  '2026-08-10', 8, 0, 0, 0, 'approved');
    `);

    // Imported after the env is set: @/lib/db builds its pool at module load.
    handler = (await import('@/pages/api/reporting/attendance')).default as typeof handler;
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS att_route CASCADE;');
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('returns ONLY the supervised staff, not the whole workforce', async () => {
    // The mutation that survived: passing null here instead of the resolved ids.
    currentScope = { allowedStaffIds: [ALICE], note: { kind: 'scoped', staffCount: 1 } };
    const { res, captured } = mockRes();
    await handler(req({ since: '2026-01-01' }), res);

    expect(captured.status).toBe(200);
    expect(namesFrom(captured.body)).toEqual(['Alice Supervised']);
  });

  it('returns nothing for a caller who supervises nobody', async () => {
    currentScope = { allowedStaffIds: [], note: { kind: 'no_scope' } };
    const { res, captured } = mockRes();
    await handler(req({ since: '2026-01-01' }), res);

    expect(captured.status).toBe(200);
    expect(namesFrom(captured.body)).toEqual([]);
  });

  it('returns everyone for an org-wide caller', async () => {
    // The mirror: without this, a route that refused EVERYONE would satisfy the two above.
    currentScope = { allowedStaffIds: null, note: { kind: 'orgwide' } };
    const { res, captured } = mockRes();
    await handler(req({ since: '2026-01-01' }), res);

    expect(namesFrom(captured.body)).toEqual(['Alice Supervised', 'Bob Elsewhere']);
  });

  it('passes the scope NOTE through, so the answer says it is a slice', async () => {
    currentScope = { allowedStaffIds: [ALICE], note: { kind: 'scoped', staffCount: 1 } };
    const { res, captured } = mockRes();
    await handler(req({ since: '2026-01-01' }), res);

    const caveats = ((captured.body as { data?: { caveats?: string[] } }).data?.caveats ?? []).join(' ');
    expect(caveats).toContain('NOT the whole organisation');
  });

  it('rejects an unbounded query before touching the database', async () => {
    currentScope = { allowedStaffIds: null, note: { kind: 'orgwide' } };
    const { res, captured } = mockRes();
    await handler(req({}), res);
    expect(captured.status).toBe(400);
  });

  it('rejects an impossible date as 400, not 500', async () => {
    currentScope = { allowedStaffIds: null, note: { kind: 'orgwide' } };
    const { res, captured } = mockRes();
    await handler(req({ since: '2026-02-30' }), res);
    expect(captured.status).toBe(400);
  });
});

/**
 * Integration tests for GET /api/snags/reports-scope-xlsx
 *
 * Uses a real Postgres connection (same vi.hoisted pattern as reports-scope.test.ts).
 * Auth is mocked to bypass RBAC; xlsx output is validated by headers + status.
 */

process.env.DATABASE_URL =
  'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow';

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';

// ── Real DB helpers via vi.hoisted ─────────────────────────────────────────────
// vi.mock factories are hoisted, so helpers must be captured with vi.hoisted.

const { realPool, realSql } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as { Pool: typeof import('pg').Pool };

  const pool = new Pool({
    connectionString:
      'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow',
    ssl: false,
    max: 5,
  });

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (acc: string, s: string, i: number) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    const r = await pool.query(text, values);
    return r.rows;
  };

  return { realPool: pool, realSql: sql };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db-pool', () => ({ sql: realSql }));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    withAuth: (handler: unknown) => async (req: any, res: any) => {
      req.user = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'test@vf',
        role: 'manager',
      };
      // @ts-expect-error dynamic handler invocation
      return handler(req, res);
    },
    withPermission: () => (handler: unknown) => handler,
  };
});

import handler from '../reports-scope-xlsx';

// ── Test suite ────────────────────────────────────────────────────────────────

describe('GET /api/snags/reports-scope-xlsx', () => {
  let reportId: string;
  let projectId: string;

  beforeEach(async () => {
    const p = (await realSql`
      SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1
    `) as Array<{ id: string }>;
    projectId = p[0]!.id;

    await realSql`DELETE FROM snag_reports WHERE report_number = 'SCOPE-XLSX-TEST'`;

    const ins = (await realSql`
      INSERT INTO snag_reports (
        project_id, report_number, source, audit_date,
        scope, scope_zone_no, scope_from_date, scope_to_date,
        scope_severities, scope_categories,
        pdf_url, generated_at, total_findings
      ) VALUES (
        ${projectId}, 'SCOPE-XLSX-TEST', 'scope', CURRENT_DATE,
        'zone', 24, '2026-04-20', '2026-05-20',
        ARRAY['major']::text[], ARRAY['pole_quality']::text[],
        'https://example/test.pdf', NOW(), 0
      )
      RETURNING id
    `) as Array<{ id: string }>;

    reportId = ins[0]!.id;
  });

  afterAll(async () => {
    await realSql`DELETE FROM snag_reports WHERE report_number = 'SCOPE-XLSX-TEST'`;
    await realPool.end();
  });

  it('returns 400 if id query param missing', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 404 for unknown report id', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { id: '00000000-0000-0000-0000-000000000000' },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(404);
  });

  it('streams xlsx with correct content-type for valid id', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { id: reportId },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(String(res.getHeader('content-type'))).toContain('spreadsheetml');
    expect(String(res.getHeader('content-disposition'))).toContain('SCOPE-XLSX-TEST.xlsx');
  });
});

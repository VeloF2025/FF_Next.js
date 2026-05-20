/**
 * Integration tests for GET /api/snags/reports?source= filter (T6)
 *
 * Uses a real Postgres connection so the source filter exercises real SQL.
 * The Neon serverless shim and auth layer are mocked for hermeticity.
 */

process.env.DATABASE_URL =
  'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow';

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import { Pool } from 'pg';

const realPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 5 });

// Mock @neondatabase/serverless so the route's `neon(...)` returns a tagged-template
// function backed by our real pg.Pool.
vi.mock('@neondatabase/serverless', () => ({
  neon: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (acc: string, s: string, i: number) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    const r = await realPool.query(text, values);
    return r.rows;
  },
  neonConfig: { fetchConnectionCache: false },
}));

// Mock auth so the handler runs as a privileged user.
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    withAuth: (handler: unknown) => async (req: any, res: any) => {
      req.user = { id: '00000000-0000-0000-0000-000000000001', email: 'test@vf', role: 'manager' };
      // @ts-expect-error dynamic
      return handler(req, res);
    },
  };
});

import handler from '../reports';

// Tagged-template helper backed by the real pool — used in beforeEach/afterAll.
const realSql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce(
    (acc: string, s: string, i: number) => acc + s + (i < values.length ? `$${i + 1}` : ''),
    '',
  );
  const r = await realPool.query(text, values);
  return r.rows;
};

describe('GET /api/snags/reports ?source= filter', () => {
  let projectId: string;

  beforeEach(async () => {
    const p = await realSql`SELECT id FROM projects LIMIT 1` as { id: string }[];
    projectId = p[0]!.id;
    await realSql`DELETE FROM snag_reports WHERE report_number LIKE 'SRC-FILTER-%'`;
    await realSql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date, pdf_url, generated_at)
      VALUES (${projectId}, 'SRC-FILTER-A', 'scope',    CURRENT_DATE, 'https://x/a.pdf', NOW()),
             (${projectId}, 'SRC-FILTER-B', 'tqr',      CURRENT_DATE, NULL,               NULL),
             (${projectId}, 'SRC-FILTER-C', 'works_qa', CURRENT_DATE, NULL,               NULL)
    `;
  });

  afterAll(async () => {
    await realSql`DELETE FROM snag_reports WHERE report_number LIKE 'SRC-FILTER-%'`;
    await realPool.end();
  });

  it('returns only scope rows when source=scope', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { projectId, source: 'scope', pageSize: '100' },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const data = body.data as Array<{ source: string; report_number: string }>;
    const ourRows = data.filter(r => r.report_number.startsWith('SRC-FILTER-'));
    expect(ourRows.every(r => r.source === 'scope')).toBe(true);
    expect(ourRows.some(r => r.report_number === 'SRC-FILTER-A')).toBe(true);
    expect(ourRows.some(r => r.report_number === 'SRC-FILTER-B')).toBe(false);
  });

  it('returns only tqr rows when source=tqr', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { projectId, source: 'tqr', pageSize: '100' },
    });
    await handler(req as any, res as any);
    const data = JSON.parse(res._getData()).data as Array<{ source: string; report_number: string }>;
    const ourRows = data.filter(r => r.report_number.startsWith('SRC-FILTER-'));
    expect(ourRows.every(r => r.source === 'tqr')).toBe(true);
    expect(ourRows.some(r => r.report_number === 'SRC-FILTER-B')).toBe(true);
  });

  it('returns all rows (any source) when source query param omitted', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { projectId, pageSize: '100' },
    });
    await handler(req as any, res as any);
    const data = JSON.parse(res._getData()).data as Array<{ report_number: string }>;
    const reportNumbers = data.map(r => r.report_number).filter(n => n.startsWith('SRC-FILTER-'));
    expect(reportNumbers).toEqual(
      expect.arrayContaining(['SRC-FILTER-A', 'SRC-FILTER-B', 'SRC-FILTER-C']),
    );
  });

  it('ignores invalid source values (returns all)', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { projectId, source: 'invalid', pageSize: '100' },
    });
    await handler(req as any, res as any);
    const data = JSON.parse(res._getData()).data as Array<{ report_number: string }>;
    const reportNumbers = data.map(r => r.report_number).filter(n => n.startsWith('SRC-FILTER-'));
    expect(reportNumbers.length).toBe(3); // all 3 returned
  });
});

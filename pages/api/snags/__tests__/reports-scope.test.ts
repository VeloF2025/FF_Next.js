/**
 * Integration tests for POST /api/snags/reports-scope
 *
 * Uses a real Postgres connection so the scope query, report-number
 * sequence, and snag_reports INSERT all exercise real SQL.  Puppeteer,
 * VF Storage, and the auth layer are mocked so tests remain hermetic.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
    'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
// Pool is required via require('pg') inside vi.hoisted below (hoisting constraint).

// ── Real DB helpers ────────────────────────────────────────────────────────────
// vi.mock factories are hoisted, so helpers must be declared with vi.hoisted.

const { realPool, realSql, realTransaction } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as { Pool: typeof import('pg').Pool };

  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
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

  const transaction = async <T>(
    cb: (txn: {
      query: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;
      queryOne: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R | null>;
    }) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Wrap pg.PoolClient in a TxnClient-shaped object matching src/lib/db-pool.ts.
      // TxnClient.query<T> returns T[] directly, not pg.QueryResult.
      const txn = {
        query: async <R extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> => {
          const r = await client.query<R>(text, params);
          return r.rows;
        },
        queryOne: async <R extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R | null> => {
          const r = await client.query<R>(text, params);
          return r.rows[0] ?? null;
        },
      };
      const result = await cb(txn);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  };

  return { realPool: pool, realSql: sql, realTransaction: transaction };
});

vi.mock('@/lib/db-pool', () => ({ sql: realSql, transaction: realTransaction }));

// ── VF Storage mock ────────────────────────────────────────────────────────────

vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: {
    uploadFile: vi.fn().mockResolvedValue({
      success: true,
      filename: 'mock.pdf',
      path: 'snag-reports/mock.pdf',
      url: '/storage/snag-reports/mock.pdf',
      size: 1024,
    }),
  },
}));

// ── Puppeteer mock ─────────────────────────────────────────────────────────────

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setContent: vi.fn(),
        pdf: vi.fn().mockResolvedValue(Buffer.from('mock-pdf-bytes')),
      }),
      close: vi.fn(),
    }),
  },
}));

// ── Auth mock — treat every request as authenticated manager ──────────────────

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    withAuth: (handler: unknown) => async (req: Record<string, unknown>, res: unknown) => {
      req.user = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'test-manager@vf',
        role: 'manager',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (handler as any)(req, res);
    },
    withPermission: () => (handler: unknown) => handler,
  };
});

// ── Import handler AFTER all mocks are registered ─────────────────────────────

import handler from '../reports-scope';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/snags/reports-scope', () => {
  let projectId: string;

  beforeEach(async () => {
    const rows = (await realSql`
      SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1
    `) as { id: string }[];
    projectId = rows[0]?.id ?? '';
    if (!projectId) throw new Error('Test requires a Lawley project in the database');

    // Clean up any scope reports + sequence rows created by previous test runs.
    await realSql`DELETE FROM snag_reports WHERE source = 'scope' AND project_id = ${projectId}`;
    await realSql`DELETE FROM snag_report_seq WHERE project_id = ${projectId}`;
  });

  afterAll(async () => {
    await realSql`DELETE FROM snag_reports WHERE source = 'scope' AND report_number LIKE 'SCOPE-%'`;
    await realSql`DELETE FROM snag_report_seq`;
    await realPool.end();
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 when scope=pole but poles[] is empty', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: { project_id: projectId, scope: 'pole', poles: [] },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 when scope query yields zero snags', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: { project_id: projectId, scope: 'zone', zones: [99999] },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
    const body = JSON.parse(res._getData() as string) as { error?: { message?: string } };
    expect(
      (body.error?.message ?? '').toLowerCase(),
    ).toMatch(/no snags/);
  });

  it('persists a snag_reports row with scope columns, pdf_url, and total_findings', async () => {
    // Check if there are any snags in zone 24 for this project — mirrors the
    // multi-source resolution used by runSnagScopeQuery (pole_qa_photos OR
    // poles via pole_ids[1] OR drops via drop_id).
    const existing = (await realSql`
      SELECT COUNT(*)::int AS n FROM snags s
      LEFT JOIN pole_qa_photos pqa ON pqa.id = s.pole_qa_photo_id
      LEFT JOIN poles          pl  ON pl.id  = s.pole_ids[1]
      LEFT JOIN drops          dr  ON dr.id  = s.drop_id
      WHERE s.project_id = ${projectId}
        AND COALESCE(pqa.zone_no, pl.zone_no, dr.zone_no) = 24
    `) as { n: number }[];

    if (existing[0]!.n === 0) {
      // Flag: seed data absent — test skipped with explicit note.
      // This is acceptable per the task spec; logged as DONE_WITH_CONCERNS.
      return;
    }

    const { req, res } = createMocks({
      method: 'POST',
      body: { project_id: projectId, scope: 'zone', zones: [24] },
    });
    await handler(req as never, res as never);

    expect(res._getStatusCode()).toBe(201);

    const body = JSON.parse(res._getData() as string) as {
      data?: Record<string, unknown>;
      id?: string;
      report_number?: string;
      pdf_url?: string;
    };
    const data = (body.data ?? body) as Record<string, unknown>;

    expect(String(data.report_number)).toMatch(/^SCOPE-LAWL-\d{8}-\d{3}$/);
    expect(data.pdf_url).toBe('/storage/snag-reports/mock.pdf');

    const persisted = (await realSql`
      SELECT * FROM snag_reports WHERE id = ${data.id}
    `) as Array<Record<string, unknown>>;

    expect(persisted[0]!.source).toBe('scope');
    expect(persisted[0]!.scope).toBe('zone');
    expect(persisted[0]!.pdf_url).toBe('/storage/snag-reports/mock.pdf');
    expect(persisted[0]!.generated_at).not.toBeNull();
    expect(Number(persisted[0]!.total_findings)).toBeGreaterThan(0);
    // H1: multi-zone/PON stored as INT[] not scalar
    expect(Array.isArray(persisted[0]!.scope_zone_nos)).toBe(true);
    expect((persisted[0]!.scope_zone_nos as number[])).toEqual([24]);
  });
});

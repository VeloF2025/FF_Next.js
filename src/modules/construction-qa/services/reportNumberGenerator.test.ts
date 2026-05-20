// src/modules/construction-qa/services/reportNumberGenerator.test.ts
//
// Integration test — needs the real DB to verify advisory-lock behaviour.
// Mirrors the T1 setup pattern: override DATABASE_URL before pg imports.
process.env.DATABASE_URL =
  'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow';

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import type { TxnClient } from '@/lib/db-pool';

// ---------------------------------------------------------------------------
// Real-DB pool — bypasses the globally-mocked @/lib/db in vitest.setup.ts
// ---------------------------------------------------------------------------

const realPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function realSql<T extends Record<string, unknown> = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  let text = '';
  const params: unknown[] = [];
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  });
  const r = await realPool.query<T>(text, params);
  return r.rows;
}

async function realTransaction<T>(cb: (txn: TxnClient) => Promise<T>): Promise<T> {
  const client = await realPool.connect();
  try {
    await client.query('BEGIN');
    const txn: TxnClient = {
      client,
      async query<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params: unknown[] = []
      ): Promise<R[]> {
        const res = await client.query<R>(text, params);
        return res.rows;
      },
      async queryOne<R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params: unknown[] = []
      ): Promise<R | null> {
        const res = await client.query<R>(text, params);
        return res.rows[0] ?? null;
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
}

// vi.mock is hoisted, so the factory must not reference module-level variables.
// Use vi.hoisted to create shared state that is available before hoisting.
const mocks = vi.hoisted(() => {
  const { Pool: PgPool } = require('pg');
  const pool = new PgPool({
    connectionString:
      'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow',
    ssl: false,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const params: unknown[] = [];
    strings.forEach((str: string, i: number) => {
      text += str;
      if (i < values.length) {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    });
    const r = await pool.query(text, params);
    return r.rows;
  };

  const transaction = async (cb: (txn: unknown) => Promise<unknown>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txn = {
        client,
        async query(text: string, params: unknown[] = []) {
          const res = await client.query(text, params);
          return res.rows;
        },
        async queryOne(text: string, params: unknown[] = []) {
          const res = await client.query(text, params);
          return res.rows[0] ?? null;
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

  return { pool, sql, transaction };
});

vi.mock('@/lib/db-pool', () => ({
  sql: mocks.sql,
  transaction: mocks.transaction,
}));

import { generateScopeReportNumber } from './reportNumberGenerator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateScopeReportNumber', () => {
  let projectId: string;

  beforeEach(async () => {
    const rows = await realSql<{ id: string }>`
      SELECT id FROM projects WHERE project_name ILIKE 'lawley%' LIMIT 1
    `;
    projectId = rows[0]?.id;
    if (!projectId) throw new Error('Test requires a Lawley project to exist');
    await realSql`
      DELETE FROM snag_reports
      WHERE source = 'scope'
        AND project_id = ${projectId}
        AND report_number LIKE 'SCOPE-%'
    `;
    // Reset the counter so each test starts from seq 1.
    await realSql`
      DELETE FROM snag_report_seq
      WHERE project_id = ${projectId}
        AND date_part = '20260520'
    `;
  });

  afterAll(async () => {
    await realPool.end();
    await mocks.pool.end();
  });

  it('returns SCOPE-<projectCode>-<YYYYMMDD>-001 on first call', async () => {
    const num = await generateScopeReportNumber(projectId, new Date('2026-05-20T12:00:00Z'));
    expect(num).toMatch(/^SCOPE-LAWL-20260520-001$/);
  });

  it('increments sequence for same project + date', async () => {
    await realSql`
      INSERT INTO snag_reports
        (project_id, report_number, source, audit_date, pdf_url, generated_at)
      VALUES
        (${projectId}, 'SCOPE-LAWL-20260520-001', 'scope', '2026-05-20', 'x', NOW())
    `;
    const num = await generateScopeReportNumber(projectId, new Date('2026-05-20T12:00:00Z'));
    expect(num).toBe('SCOPE-LAWL-20260520-002');
  });

  it('serialises concurrent calls via advisory lock — distinct sequences', async () => {
    const [a, b] = await Promise.all([
      generateScopeReportNumber(projectId, new Date('2026-05-20T12:00:00Z')),
      generateScopeReportNumber(projectId, new Date('2026-05-20T12:00:00Z')),
    ]);
    // Both numbers should be distinct (advisory lock serialises the generators)
    expect(a).not.toBe(b);
    expect([a, b].sort()).toEqual(['SCOPE-LAWL-20260520-001', 'SCOPE-LAWL-20260520-002']);
  });
});

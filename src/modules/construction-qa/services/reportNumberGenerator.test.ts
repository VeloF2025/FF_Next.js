// src/modules/construction-qa/services/reportNumberGenerator.test.ts
//
// Integration test — needs the real DB to verify advisory-lock behaviour.
// Mirrors the T1 setup pattern: override DATABASE_URL before pg imports.
//
// Requires TEST_DATABASE_URL env var (see .env.local.example).

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
    'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Real-DB pool — bypasses the globally-mocked @/lib/db in vitest.setup.ts
// ---------------------------------------------------------------------------

const realPool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
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

/** Returns today's UTC date formatted as YYYYMMDD for report number matching. */
function todayPart(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

// vi.mock is hoisted, so the factory must not reference module-level variables.
// Use vi.hoisted to create shared state that is available before hoisting.
const mocks = vi.hoisted(() => {
  const { Pool: PgPool } = require('pg');
  const pool = new PgPool({
    connectionString: process.env.TEST_DATABASE_URL,
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

    const datePart = todayPart();
    await realSql`
      DELETE FROM snag_reports
      WHERE source = 'scope'
        AND project_id = ${projectId}
        AND report_number LIKE ${'SCOPE-LAWL-' + datePart + '-%'}
    `;
    // Reset the counter so each test starts from seq 1.
    await realSql`
      DELETE FROM snag_report_seq
      WHERE project_id = ${projectId}
        AND date_part = ${datePart}
    `;
  });

  afterAll(async () => {
    await realPool.end();
    await mocks.pool.end();
  });

  it('returns SCOPE-<projectCode>-<YYYYMMDD>-001 on first call', async () => {
    const num = await generateScopeReportNumber(projectId, new Date());
    expect(num).toMatch(/^SCOPE-LAWL-\d{8}-001$/);
  });

  it('increments sequence for same project + date', async () => {
    const datePart = todayPart();
    await realSql`
      INSERT INTO snag_reports
        (project_id, report_number, source, audit_date, pdf_url, generated_at)
      VALUES
        (${projectId}, ${'SCOPE-LAWL-' + datePart + '-001'}, 'scope', CURRENT_DATE, 'x', NOW())
    `;
    const num = await generateScopeReportNumber(projectId, new Date());
    expect(num).toMatch(/^SCOPE-LAWL-\d{8}-002$/);
  });

  it('serialises concurrent calls via advisory lock — distinct sequences', async () => {
    const [a, b] = await Promise.all([
      generateScopeReportNumber(projectId, new Date()),
      generateScopeReportNumber(projectId, new Date()),
    ]);
    // Both numbers should be distinct (advisory lock serialises the generators)
    expect(a).not.toBe(b);
    const sorted = [a, b].sort();
    expect(sorted[0]).toMatch(/^SCOPE-LAWL-\d{8}-001$/);
    expect(sorted[1]).toMatch(/^SCOPE-LAWL-\d{8}-002$/);
  });
});

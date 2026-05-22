/**
 * Integration test for migration 378 — RBAC force-correct permission.
 *
 * Verifies that migration 378 correctly seeds:
 *   - access_permissions row for 'procurement.field-stock.force-correct'
 *   - role_permissions grant for super_admin (view + edit)
 *
 * Pattern mirrors tests/migrations/358_snag_reports_scope.test.ts:
 *   - Requires TEST_DATABASE_URL env var (real DB, not live prod).
 *   - Assumes the migration has already been applied by the runner before
 *     this test executes (schema-verify style, not self-applying).
 *   - Run via: TEST_DATABASE_URL=... npx vitest run tests/migrations/378_...
 *
 * IMPORTANT: Do NOT point TEST_DATABASE_URL at the live Supabase DB
 * (100.96.203.105:5437). This test is safe on any dedicated test DB that
 * has the access_permissions + role_permissions tables present.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../scripts/migrations/sql/378_rbac_field_stock_force_correct.sql',
);

// Use a dedicated pool instance so the global vitest mock of @/lib/db
// does not interfere with direct SQL queries.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
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
  const result = await pool.query<T>(text, params);
  return result.rows;
}

describe('migration 378 — RBAC procurement.field-stock.force-correct', () => {
  beforeAll(async () => {
    // Migration runner is expected to have applied 378 already in CI;
    // this test verifies the resulting data shape.
    await pool.query('SELECT 1'); // warm connection
  });

  it('seeds the permission row in access_permissions with correct type and parent', async () => {
    const rows = await sql`
      SELECT key, type, parent_key, label, description
      FROM access_permissions
      WHERE key = 'procurement.field-stock.force-correct'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'procurement.field-stock.force-correct',
      type: 'action',
      parent_key: 'procurement.field-stock',
    });
    expect(rows[0].label).toBeTruthy();
    expect(rows[0].description).toBeTruthy();
  });

  it('is idempotent — re-applying the migration SQL does not error or duplicate rows', async () => {
    // Re-execute the full migration SQL to genuinely exercise the ON CONFLICT
    // paths (not just assert COUNT after a single apply).
    const sqlText = readFileSync(MIGRATION_PATH, 'utf8');
    await pool.query(sqlText);

    // access_permissions: ON CONFLICT (key) DO UPDATE — must remain exactly 1 row.
    const apRows = await sql`
      SELECT COUNT(*)::int AS n FROM access_permissions
      WHERE key = 'procurement.field-stock.force-correct'
    `;
    expect(apRows[0].n).toBe(1);

    // role_permissions: ON CONFLICT (role, permission_key) DO NOTHING — must remain exactly 1 row.
    const rpRows = await sql`
      SELECT COUNT(*)::int AS n FROM role_permissions
      WHERE role = 'super_admin'
        AND permission_key = 'procurement.field-stock.force-correct'
    `;
    expect(rpRows[0].n).toBe(1);
  });

  it('grants super_admin view+edit and withholds create+delete', async () => {
    const rows = await sql`
      SELECT actions FROM role_permissions
      WHERE role = 'super_admin'
        AND permission_key = 'procurement.field-stock.force-correct'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].actions).toMatchObject({
      view: true,
      edit: true,
      create: false,
      delete: false,
    });
  });

  it('is recorded in the migrations table', async () => {
    const rows = await sql`
      SELECT version, name FROM migrations
      WHERE version = '378'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('rbac_field_stock_force_correct');
  });
});

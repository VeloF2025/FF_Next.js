/**
 * Integration test for migration 358 — snag_reports scope columns.
 *
 * Connects directly to the local Supabase proxy DB (same creds used by
 * scripts/migrations/ runner) and verifies the schema shape that migration
 * 358 should produce.
 *
 * Run order: apply 358 → run this test → (optional) apply rollback_358.
 */

// Override DATABASE_URL at process level before any pool singleton initialises.
// vitest.setup.ts sets a fake "test" URL; migration tests need the real DB.
process.env.DATABASE_URL =
  'postgresql://postgres.ironman-platform:a23f6104debd1d3e88e8f00c0067f22f@localhost:5436/fibreflow';

import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';

// Use a dedicated pool instance for migration tests so the global vitest mock
// of @/lib/db does not interfere.
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

describe('migration 358 — snag_reports scope columns', () => {
  beforeAll(async () => {
    // Migration runner is expected to have applied 358 already in CI; this test
    // verifies the resulting schema shape.
  });

  it('adds scope, scope_zone_no, scope_pon_no, scope_poles columns', async () => {
    const rows = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'snag_reports'
        AND column_name IN ('scope', 'scope_zone_no', 'scope_pon_no', 'scope_poles',
                            'scope_from_date', 'scope_to_date', 'scope_severities',
                            'scope_categories', 'pdf_url', 'generated_by', 'generated_at')
      ORDER BY column_name
    `;
    expect(rows.map(r => r.column_name)).toEqual([
      'generated_at', 'generated_by', 'pdf_url',
      'scope', 'scope_categories', 'scope_from_date', 'scope_poles',
      'scope_pon_no', 'scope_severities', 'scope_to_date', 'scope_zone_no',
    ]);
  });

  it('extends source check to allow "scope"', async () => {
    await expect(sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date,
                                pdf_url, generated_at)
      VALUES ((SELECT id FROM projects LIMIT 1),
              'SCOPE-TEST-20260520-1', 'scope', CURRENT_DATE,
              'https://example/test.pdf', NOW())
      RETURNING id
    `).resolves.toHaveLength(1);
    await sql`DELETE FROM snag_reports WHERE report_number = 'SCOPE-TEST-20260520-1'`;
  });

  it('enforces scope rows require pdf_url and generated_at', async () => {
    await expect(sql`
      INSERT INTO snag_reports (project_id, report_number, source, audit_date)
      VALUES ((SELECT id FROM projects LIMIT 1),
              'SCOPE-TEST-NULL-PDF', 'scope', CURRENT_DATE)
    `).rejects.toThrow(/snag_reports_scope_requires_pdf/);
  });

  it('creates snag_reports_scope_idx', async () => {
    const rows = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'snag_reports' AND indexname = 'snag_reports_scope_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});

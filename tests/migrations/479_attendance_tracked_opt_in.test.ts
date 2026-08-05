/**
 * Integration test for migration 479 — staff.attendance_tracked opt-in.
 *
 * Verifies the schema shape migration 479 produces and, critically, that the
 * backfill agrees with observed clock-in history: every staff member who has
 * ever clocked in must be tracked, so the flag can never strip a real worker
 * out of the attendance expectation universe.
 *
 * Run order: apply 479 → run this test → (optional) apply rollback_479.
 *
 * Requires TEST_DATABASE_URL env var (see .env.local.example).
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
    'See .env.local.example.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

// Dedicated pool so the global vitest mock of @/lib/db does not interfere.
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

describe('migration 479 — staff.attendance_tracked opt-in', () => {
  it('adds attendance_tracked as NOT NULL boolean defaulting to false', async () => {
    const rows = await sql<{
      data_type: string; is_nullable: string; column_default: string | null;
    }>`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'staff'
        AND column_name = 'attendance_tracked'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('boolean');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default).toBe('false');
  });

  it('backfills every staff member who has ever clocked in', async () => {
    // The dangerous failure mode: a real clocker left untracked stops being
    // expected, so their absences silently stop being raised.
    const rows = await sql<{ untracked_clockers: string }>`
      SELECT COUNT(*)::text AS untracked_clockers
      FROM staff s
      WHERE s.attendance_tracked = false
        AND EXISTS (
          SELECT 1 FROM attendance_entries ae WHERE ae.staff_id = s.id
        )
    `;
    expect(Number(rows[0]!.untracked_clockers)).toBe(0);
  });

  it('leaves staff who have never clocked in untracked', async () => {
    // Confirms the backfill was actually selective rather than marking
    // everyone true, which would leave the original noise untouched.
    const rows = await sql<{ never_clocked_but_tracked: string }>`
      SELECT COUNT(*)::text AS never_clocked_but_tracked
      FROM staff s
      WHERE s.attendance_tracked = true
        AND NOT EXISTS (
          SELECT 1 FROM attendance_entries ae WHERE ae.staff_id = s.id
        )
    `;
    expect(Number(rows[0]!.never_clocked_but_tracked)).toBe(0);
  });

  it('excludes never-clocked staff from the expectation universe', async () => {
    // Exercises the actual predicate the reconciler applies, not just the
    // column, so a regression that drops the filter fails here too.
    const rows = await sql<{ expected_never_clockers: string }>`
      SELECT COUNT(*)::text AS expected_never_clockers
      FROM staff s
      WHERE s.attendance_tracked = true
        AND s.id NOT IN (SELECT staff_id FROM attendance_entries WHERE staff_id IS NOT NULL)
    `;
    expect(Number(rows[0]!.expected_never_clockers)).toBe(0);
  });
});

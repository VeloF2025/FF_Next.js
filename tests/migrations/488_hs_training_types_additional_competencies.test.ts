/**
 * Integration test for migration 488 — five added training competencies.
 *
 * A catalogue seed looks too simple to test until you notice what a second
 * application would do. The rows are keyed by a unique `code`, and admins may
 * legitimately rename a competency or change its validity afterwards; a seed
 * written with DO UPDATE would quietly revert those edits every time the
 * migration runner re-ran it. So this applies the migration, edits a row the
 * way an admin would, applies it again, and asserts the edit survived.
 *
 * Requires TEST_DATABASE_URL. Run with: npm run test:migrations
 *
 * SAFETY: scratch schema, dropped unconditionally in afterAll. The rollback
 * file is not run here — it carries its own COMMIT, which would end the
 * wrapping transaction and commit the scratch schema.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig488_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/488_hs_training_types_additional_competencies.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const NEW_CODES = [
  'legal_liability',
  'incident_investigator',
  'she_supervisor',
  'ladder_inspector',
  'fall_protection_planner',
];

/** Live shape of the columns this migration writes. */
const PREREQUISITES = `
  CREATE TABLE hs_training_types (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 varchar(64)  NOT NULL UNIQUE,
    name                 varchar(160) NOT NULL,
    description          text,
    validity_months      integer,
    is_statutory         boolean NOT NULL DEFAULT false,
    requires_certificate boolean NOT NULL DEFAULT true,
    is_active            boolean NOT NULL DEFAULT true,
    sort_order           integer NOT NULL DEFAULT 0,
    created_by           uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hs_training_types_validity_positive
      CHECK (validity_months IS NULL OR validity_months > 0)
  );
`;

async function scoped<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(PREREQUISITES);
  await scoped(FORWARD);
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await pool.end();
});

describe('migration 488 — additional training competencies', () => {
  it('adds all five competencies', async () => {
    const rows = await scoped<{ code: string }>(
      `SELECT code FROM hs_training_types WHERE code = ANY($1) ORDER BY code`,
      [NEW_CODES]
    );
    expect(rows.map((r) => r.code).sort()).toEqual([...NEW_CODES].sort());
  });

  it('records the validity periods Hein confirmed', async () => {
    const rows = await scoped<{ code: string; validity_months: number }>(
      `SELECT code, validity_months FROM hs_training_types WHERE code = ANY($1)`,
      [NEW_CODES]
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.validity_months]));

    expect(byCode.legal_liability).toBe(24);
    expect(byCode.incident_investigator).toBe(24);
    expect(byCode.she_supervisor).toBe(24);
    // The one deliberate exception — ladder inspection is an annual duty.
    expect(byCode.ladder_inspector).toBe(12);
    expect(byCode.fall_protection_planner).toBe(24);
  });

  it('marks them statutory and certificate-bearing', async () => {
    const rows = await scoped<{ is_statutory: boolean; requires_certificate: boolean }>(
      `SELECT is_statutory, requires_certificate
         FROM hs_training_types WHERE code = ANY($1)`,
      [NEW_CODES]
    );
    expect(rows).toHaveLength(5);
    // requires_certificate = false would route these through
    // /health-safety/training/new, which writes a record straight to 'verified'
    // with no certificate at all.
    expect(rows.every((r) => r.is_statutory && r.requires_certificate)).toBe(true);
  });

  it('does not revert an admin edit when re-run', async () => {
    await scoped(
      `UPDATE hs_training_types
          SET name = 'Legal Liability (renamed by an admin)', validity_months = 36
        WHERE code = 'legal_liability'`
    );

    await scoped(FORWARD);

    const [row] = await scoped<{ name: string; validity_months: number }>(
      `SELECT name, validity_months FROM hs_training_types WHERE code = 'legal_liability'`
    );
    expect(row?.name).toBe('Legal Liability (renamed by an admin)');
    expect(row?.validity_months).toBe(36);
  });

  it('does not duplicate rows on a re-run', async () => {
    const [row] = await scoped<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM hs_training_types WHERE code = ANY($1)`,
      [NEW_CODES]
    );
    expect(row?.count).toBe('5');
  });
});

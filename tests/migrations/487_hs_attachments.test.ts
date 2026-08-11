/**
 * Integration test for migration 487 — H&S document attachments.
 *
 * The thing worth running real SQL for is the exclusive-arc CHECK. Its whole
 * job is to make "an attachment belongs to exactly one parent" an invariant of
 * the database rather than a convention the service layer is trusted to keep,
 * and whether a CHECK expression actually refuses a row is a property of
 * Postgres evaluating it, not of how the SQL reads. So this inserts the bad
 * rows — zero parents, two parents — and asserts the refusal came from
 * `hs_attachments_exactly_one_parent` BY NAME. Asserting merely that an error
 * occurred would pass just as happily on a typo'd column or a missing table.
 *
 * ON DELETE CASCADE gets the same treatment: an orphaned health-data file is
 * the failure this design exists to prevent, so the test deletes a medical
 * record and asserts the attachment row went with it.
 *
 * Sibling of 471_hs_training_certificate_upload: requires TEST_DATABASE_URL,
 * and is excluded from the unit vitest config because it throws at module load
 * without one. Run with:
 *
 *   npm run test:migrations
 *
 * SAFETY: everything happens inside a scratch schema dropped unconditionally in
 * afterAll. The rollback file is never run here — it carries its own COMMIT,
 * which would end the wrapping transaction and commit the scratch schema (this
 * is how a stray mig469_scratch schema was once left in the shared database).
 * Point it at a throwaway database anyway; a scratch schema is a seatbelt, not
 * permission.
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

const SCHEMA = 'mig487_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/487_hs_attachments.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const MEDICAL = '11111111-1111-1111-1111-111111111111';
const LIBRARY = '22222222-2222-2222-2222-222222222222';
const UPLOADER = '33333333-3333-3333-3333-333333333333';

/**
 * The seven parent tables, reduced to what the foreign keys actually need.
 * Only `id` matters here: 487 adds no column to any of them and reads none of
 * their data, so mirroring their full live shape would be noise that rots.
 */
const PREREQUISITES = `
  CREATE TABLE hs_worker_medicals      (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_contractor_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_safety_library       (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_toolbox_talks        (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_corrective_actions   (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_appointment_letters  (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_permits              (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

async function scoped<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/** Returns the constraint name Postgres refused with, or null if it accepted. */
async function refusedBy(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await scoped(sql, params);
    return null;
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? 'UNNAMED';
  }
}

const insertOneParent = (column: string) =>
  `INSERT INTO hs_attachments (${column}, file_path, file_name, file_size, mime_type, uploaded_by)
   VALUES ($1, $2, 'cert.pdf', 1024, 'application/pdf', $3)`;

beforeAll(async () => {
  await scoped(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(PREREQUISITES);
  await scoped(FORWARD);
  await scoped(`INSERT INTO hs_worker_medicals (id) VALUES ($1)`, [MEDICAL]);
  await scoped(`INSERT INTO hs_safety_library  (id) VALUES ($1)`, [LIBRARY]);
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await pool.end();
});

describe('migration 487 — hs_attachments', () => {
  it('accepts an attachment with exactly one parent', async () => {
    const refusal = await refusedBy(insertOneParent('medical_id'), [
      MEDICAL,
      'hs-private/medicals/one-parent.pdf',
      UPLOADER,
    ]);
    expect(refusal).toBeNull();
  });

  it('refuses an attachment with NO parent, by constraint name', async () => {
    const refusal = await refusedBy(
      `INSERT INTO hs_attachments (file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ('hs-private/medicals/orphan.pdf', 'orphan.pdf', 1024, 'application/pdf', $1)`,
      [UPLOADER]
    );
    expect(refusal).toBe('hs_attachments_exactly_one_parent');
  });

  it('refuses an attachment with TWO parents, by constraint name', async () => {
    const refusal = await refusedBy(
      `INSERT INTO hs_attachments (medical_id, library_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, 'hs-private/medicals/two-parents.pdf', 'two.pdf', 1024, 'application/pdf', $3)`,
      [MEDICAL, LIBRARY, UPLOADER]
    );
    expect(refusal).toBe('hs_attachments_exactly_one_parent');
  });

  it('refuses a zero-byte file, by constraint name', async () => {
    const refusal = await refusedBy(
      `INSERT INTO hs_attachments (library_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, 'hs-private/library/empty.pdf', 'empty.pdf', 0, 'application/pdf', $2)`,
      [LIBRARY, UPLOADER]
    );
    expect(refusal).toBe('hs_attachments_file_size_positive');
  });

  it('refuses two attachments at the same storage path', async () => {
    const path = 'hs-private/library/duplicate.pdf';
    await scoped(insertOneParent('library_id'), [LIBRARY, path, UPLOADER]);

    const refusal = await refusedBy(insertOneParent('library_id'), [LIBRARY, path, UPLOADER]);
    expect(refusal).toBe('hs_attachments_file_path_key');
  });

  it('deletes the attachment when its parent record is deleted', async () => {
    const doomed = '44444444-4444-4444-4444-444444444444';
    await scoped(`INSERT INTO hs_worker_medicals (id) VALUES ($1)`, [doomed]);
    await scoped(insertOneParent('medical_id'), [
      doomed,
      'hs-private/medicals/cascade.pdf',
      UPLOADER,
    ]);

    await scoped(`DELETE FROM hs_worker_medicals WHERE id = $1`, [doomed]);

    // An orphaned health-data file is the failure this design exists to
    // prevent, so the cascade is asserted rather than assumed.
    const rows = await scoped<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM hs_attachments WHERE medical_id = $1`,
      [doomed]
    );
    expect(rows[0].count).toBe('0');
  });

  it('is rerunnable', async () => {
    // Asserted as "refused by nothing" rather than on a return value: a
    // multi-statement query yields no single rows array, so a resolves-toBeDefined
    // check tests pg's result shape instead of the migration.
    expect(await refusedBy(FORWARD)).toBeNull();
  });

  it('supports all seven parent surfaces', async () => {
    // Every arc is exercised, so a column typo'd in the migration cannot hide
    // behind the two that the other tests happen to use.
    const arcs: Array<[string, string]> = [
      ['contractor_document_id', 'hs_contractor_documents'],
      ['talk_id', 'hs_toolbox_talks'],
      ['capa_id', 'hs_corrective_actions'],
      ['letter_id', 'hs_appointment_letters'],
      ['permit_id', 'hs_permits'],
    ];

    for (const [column, table] of arcs) {
      const rows = await scoped<{ id: string }>(
        `INSERT INTO ${table} DEFAULT VALUES RETURNING id`
      );
      const refusal = await refusedBy(insertOneParent(column), [
        rows[0].id,
        `hs-private/${table}/file.pdf`,
        UPLOADER,
      ]);
      expect(refusal, `${column} should accept a valid parent`).toBeNull();
    }
  });
});

/**
 * Integration test for migration 489 — PPE acknowledgement sheets.
 *
 * Two properties are worth real SQL:
 *
 *   1. **One open sheet per worker.** The whole model rests on "the worker's
 *      current sheet" being a single unambiguous row. That is a partial unique
 *      index, and whether a partial index actually refuses the second open sheet
 *      — while still permitting any number of closed ones — is a property of
 *      Postgres evaluating it, not of how the SQL reads.
 *
 *   2. **The rewritten exclusive arc still holds.** 489 drops and recreates
 *      hs_attachments_exactly_one_parent to add an eighth arc. A rewrite is
 *      exactly where a constraint quietly stops constraining, so the old arcs
 *      are re-tested alongside the new one, by constraint name.
 *
 * Requires TEST_DATABASE_URL. Run with: npm run test:migrations
 *
 * SAFETY: scratch schema, dropped unconditionally in afterAll. The rollback file
 * is not run here — it carries its own COMMIT, which would end the wrapping
 * transaction and commit the scratch schema.
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
import { UNEVIDENCED_ISSUANCE_COUNT_SQL } from '@/modules/health-safety/services/ppeAcknowledgementService';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig489_scratch';
const read = (f: string) => readFileSync(join(process.cwd(), 'scripts/migrations/sql', f), 'utf8');
const MIG_487 = read('487_hs_attachments.sql');
const FORWARD = read('489_hs_ppe_acknowledgements.sql');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const STAFF_A = '11111111-1111-1111-1111-111111111111';
const STAFF_B = '22222222-2222-2222-2222-222222222222';
const TEAM_A = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

/** The prerequisite tables 487 and 489 reference, reduced to what the FKs need. */
const PREREQUISITES = `
  CREATE TABLE staff                   (id uuid PRIMARY KEY);
  CREATE TABLE team_members            (id uuid PRIMARY KEY);
  CREATE TABLE contractors             (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE projects                (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_worker_medicals      (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_contractor_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_safety_library       (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_toolbox_talks        (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_corrective_actions   (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_appointment_letters  (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE hs_permits              (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  -- Shaped like the live table for every column the 489 code touches.
  -- team_member_id is NOT optional here: the production count SQL references
  -- it, and a scratch table missing it fails at parse time rather than
  -- exercising the query. Its at_most_one_worker CHECK is reproduced because
  -- the load-bearing case below is a row with NEITHER worker column set, which
  -- only that constraint's shape makes legal.
  CREATE TABLE hs_ppe_issuance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ppe_item_id uuid NOT NULL,
    -- SET NULL, matching live (hs_ppe_issuance_staff_id_fkey), NOT CASCADE.
    -- The difference is semantically loaded here: on live, deleting a worker
    -- turns their PPE issues into name-only rows — precisely the category the
    -- unevidenced count excludes — rather than deleting the issues outright.
    -- A CASCADE here would let a future test assert the wrong behaviour.
    staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
    team_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
    contractor_id uuid,
    project_id uuid,
    worker_name text NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    issued_date date NOT NULL DEFAULT CURRENT_DATE,
    signature_name text,
    CONSTRAINT hs_ppe_issuance_at_most_one_worker
      CHECK (NOT (staff_id IS NOT NULL AND team_member_id IS NOT NULL))
  );
`;

async function scoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path = ${SCHEMA}, public`);
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/** Returns the constraint or index name Postgres refused with, or null. */
async function refusedBy(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await scoped(sql, params);
    return null;
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? 'UNNAMED';
  }
}

const insertSheet = (
  worker: 'staff_id' | 'team_member_id',
  id: string,
  status = 'open'
) =>
  scoped(
    `INSERT INTO hs_ppe_acknowledgements (${worker}, worker_name, status, created_by)
     VALUES ($1, 'Test Worker', $2, $3) RETURNING id`,
    [id, status, USER]
  );

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(PREREQUISITES);
  await scoped(MIG_487);
  await scoped(FORWARD);
  await scoped(`INSERT INTO staff (id) VALUES ($1), ($2)`, [STAFF_A, STAFF_B]);
  await scoped(`INSERT INTO team_members (id) VALUES ($1)`, [TEAM_A]);
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await pool.end();
});

describe('migration 489 — one open sheet per worker', () => {
  it('accepts a first open sheet', async () => {
    const rows = await insertSheet('staff_id', STAFF_A);
    expect(rows).toHaveLength(1);
  });

  it('refuses a SECOND open sheet for the same worker', async () => {
    // The invariant the whole "current sheet" concept rests on.
    const refusal = await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Test Worker', 'open', $2)`,
      [STAFF_A, USER]
    );
    expect(refusal).toBe('hs_ppe_ack_one_open_per_worker');
  });

  it('allows any number of CLOSED sheets alongside the open one', async () => {
    // A worker accumulates sheets over time; only "open" is exclusive.
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Test Worker', 'closed', $2)`, [STAFF_A, USER])).toBeNull();
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Test Worker', 'closed', $2)`, [STAFF_A, USER])).toBeNull();
  });

  it('lets a new sheet open once the previous one is closed', async () => {
    await scoped(`UPDATE hs_ppe_acknowledgements SET status='closed' WHERE staff_id=$1 AND status='open'`, [STAFF_A]);
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Test Worker', 'open', $2)`, [STAFF_A, USER])).toBeNull();
  });

  it('scopes the rule per worker, not globally', async () => {
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Other Worker', 'open', $2)`, [STAFF_B, USER])).toBeNull();
    // A team member is a different worker even though staff_id is NULL on both.
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (team_member_id, worker_name, status, created_by)
       VALUES ($1, 'Crew Worker', 'open', $2)`, [TEAM_A, USER])).toBeNull();
  });

  it('refuses a sheet with no worker, and one with two', async () => {
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (worker_name, created_by) VALUES ('Nobody', $1)`, [USER]))
      .toBe('hs_ppe_acknowledgements_one_worker');
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, team_member_id, worker_name, created_by)
       VALUES ($1, $2, 'Both', $3)`, [STAFF_B, TEAM_A, USER]))
      .toBe('hs_ppe_acknowledgements_one_worker');
  });

  it('refuses an unknown status', async () => {
    expect(await refusedBy(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'X', 'archived', $2)`, [STAFF_B, USER]))
      .toBe('hs_ppe_acknowledgements_status');
  });
});

describe('migration 489 — issuance link', () => {
  it('keeps the issuance and nulls the link when a sheet is deleted', async () => {
    const [sheet] = await insertSheet('staff_id', TEAM_A === '' ? STAFF_B : STAFF_B, 'closed') as Array<{ id: string }>;
    const [issue] = await scoped<{ id: string }>(
      `INSERT INTO hs_ppe_issuance (ppe_item_id, staff_id, worker_name, acknowledgement_id)
       VALUES (gen_random_uuid(), $1, 'Test Worker', $2) RETURNING id`,
      [STAFF_B, sheet.id]
    );

    await scoped(`DELETE FROM hs_ppe_acknowledgements WHERE id = $1`, [sheet.id]);

    // The issue is a fact about equipment that left the store; it must outlive
    // its paperwork, degraded to "unevidenced" rather than deleted.
    const rows = await scoped<{ acknowledgement_id: string | null }>(
      `SELECT acknowledgement_id FROM hs_ppe_issuance WHERE id = $1`,
      [issue.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acknowledgement_id).toBeNull();
  });
});

describe('migration 489 — rewritten attachment arc', () => {
  it('accepts an attachment on a PPE acknowledgement', async () => {
    const [sheet] = (await insertSheet('team_member_id', TEAM_A, 'closed')) as Array<{ id: string }>;
    const refusal = await refusedBy(
      `INSERT INTO hs_attachments (ppe_acknowledgement_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, 'hs-private/ppe_acknowledgements/sheet.pdf', 'sheet.pdf', 1024, 'application/pdf', $2)`,
      [sheet.id, USER]
    );
    expect(refusal).toBeNull();
  });

  it('still refuses zero parents after the constraint rewrite', async () => {
    // A rewritten CHECK is exactly where a constraint stops constraining.
    expect(await refusedBy(
      `INSERT INTO hs_attachments (file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ('hs-private/x/orphan.pdf', 'orphan.pdf', 1024, 'application/pdf', $1)`, [USER]))
      .toBe('hs_attachments_exactly_one_parent');
  });

  it('still refuses two parents, including the new arc paired with an old one', async () => {
    const [sheet] = (await insertSheet('team_member_id', TEAM_A, 'closed')) as Array<{ id: string }>;
    const [medical] = await scoped<{ id: string }>(
      `INSERT INTO hs_worker_medicals DEFAULT VALUES RETURNING id`
    );
    expect(await refusedBy(
      `INSERT INTO hs_attachments (ppe_acknowledgement_id, medical_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, 'hs-private/x/two.pdf', 'two.pdf', 1024, 'application/pdf', $3)`,
      [sheet.id, medical.id, USER]))
      .toBe('hs_attachments_exactly_one_parent');
  });

  it('cascades the scanned sheet away when the acknowledgement is deleted', async () => {
    const [sheet] = (await insertSheet('team_member_id', TEAM_A, 'closed')) as Array<{ id: string }>;
    await scoped(
      `INSERT INTO hs_attachments (ppe_acknowledgement_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, 'hs-private/ppe_acknowledgements/cascade.pdf', 'c.pdf', 10, 'application/pdf', $2)`,
      [sheet.id, USER]
    );
    await scoped(`DELETE FROM hs_ppe_acknowledgements WHERE id = $1`, [sheet.id]);

    const rows = await scoped<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM hs_attachments WHERE ppe_acknowledgement_id = $1`,
      [sheet.id]
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('is rerunnable', async () => {
    expect(await refusedBy(FORWARD)).toBeNull();
  });
});

/**
 * The unevidenced count, run as the PRODUCTION SQL against real Postgres.
 *
 * The service's unit test can only assert what the query text contains, which
 * says nothing about what it returns. The case that matters here is a name-only
 * issuance — hs_ppe_issuance's constraint is `at_most_one_worker`, so a row with
 * NEITHER staff_id nor team_member_id is legal and, per migration 453, common
 * for field crews. Such a row can never match a sheet. Counting it would inflate
 * the register banner permanently and instruct the user to upload a sheet for a
 * row the UI correctly refuses to offer one for.
 */
describe('migration 489 — unevidenced count semantics', () => {
  const STAFF_C = '55555555-5555-5555-5555-555555555555';

  async function countUnevidenced(): Promise<number> {
    const rows = await scoped<{ n: number }>(UNEVIDENCED_ISSUANCE_COUNT_SQL);
    return rows[0]!.n;
  }

  beforeAll(async () => {
    await scoped(`DELETE FROM hs_ppe_issuance`);
    await scoped(`DELETE FROM hs_ppe_acknowledgements`);
    await scoped(`INSERT INTO staff (id) VALUES ($1)`, [STAFF_C]);
  });

  it('does NOT count a name-only issuance, which can never be evidenced', async () => {
    await scoped(
      `INSERT INTO hs_ppe_issuance (ppe_item_id, worker_name)
       VALUES (gen_random_uuid(), 'Unregistered Crew Worker')`
    );
    expect(await countUnevidenced()).toBe(0);
  });

  it('counts an identified worker with no sheet at all', async () => {
    await scoped(
      `INSERT INTO hs_ppe_issuance (ppe_item_id, staff_id, worker_name)
       VALUES (gen_random_uuid(), $1, 'Registered Worker')`,
      [STAFF_C]
    );
    expect(await countUnevidenced()).toBe(1);
  });

  it('still counts them when the sheet exists but carries no proof', async () => {
    // A sheet that merely exists is not evidence.
    await scoped(
      `INSERT INTO hs_ppe_acknowledgements (staff_id, worker_name, status, created_by)
       VALUES ($1, 'Registered Worker', 'open', $2)`,
      [STAFF_C, USER]
    );
    expect(await countUnevidenced()).toBe(1);
  });

  it('stops counting them once the signed sheet is uploaded', async () => {
    const [sheet] = await scoped<{ id: string }>(
      `SELECT id FROM hs_ppe_acknowledgements WHERE staff_id = $1 AND status = 'open'`,
      [STAFF_C]
    );
    await scoped(
      `INSERT INTO hs_attachments (ppe_acknowledgement_id, file_path, file_name, file_size, mime_type, uploaded_by)
       VALUES ($1, 'hs-private/ppe_acknowledgements/signed.pdf', 's.pdf', 10, 'application/pdf', $2)`,
      [sheet.id, USER]
    );
    expect(await countUnevidenced()).toBe(0);
  });

  it('accepts an in-app signature as proof instead of a scan', async () => {
    await scoped(`DELETE FROM hs_attachments WHERE ppe_acknowledgement_id IS NOT NULL`);
    expect(await countUnevidenced()).toBe(1);

    await scoped(
      `UPDATE hs_ppe_acknowledgements SET signature_name = 'Registered Worker' WHERE staff_id = $1`,
      [STAFF_C]
    );
    expect(await countUnevidenced()).toBe(0);
  });
});

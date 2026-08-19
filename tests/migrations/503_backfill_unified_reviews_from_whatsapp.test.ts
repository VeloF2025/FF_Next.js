/**
 * Integration test for migration 503 — backfill dr_photo_unified_reviews.project
 * from the WhatsApp submission behind the DR.
 *
 * A stub-client test cannot check what matters about this migration. The
 * properties that make it safe against a database shared by dev AND production
 * are all properties of RUNNING the SQL:
 *
 *   - it only ever fills NULLs, never overwrites a project already set
 *   - it leaves rows with no qa_photo_reviews row alone (still NULL) — those
 *     are the Velo Test / Integration Test rows the read queries must keep out
 *   - it is idempotent — a second run updates nothing
 *   - the correlated subquery stays single-valued when a DR was resubmitted and
 *     so has several qa_photo_reviews rows
 *   - the SQL parses at all — a stub client asserting on query strings would
 *     happily "pass" against SQL Postgres rejects
 *
 * So this runs the real file, byte-identical, with no rewriting. 503 references
 * its tables unqualified, so pointing `search_path` at a scratch schema is
 * enough to sandbox it.
 *
 * Sibling of 473_backfill_unified_reviews_project: requires TEST_DATABASE_URL,
 * and is excluded from the unit vitest config (vitest.config.ts) because it
 * throws at module load without one. That exclusion also means
 * `npx vitest run <this file>` reports "No test files found" — see the runbook
 * in the 473 test's header for the throwaway-config workaround.
 *
 * SAFETY: everything happens in a scratch schema dropped unconditionally in
 * afterAll, on a client whose search_path points only at that schema — it
 * cannot see, let alone write, the real tables.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig503_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/503_backfill_unified_reviews_from_whatsapp.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

/** Client pinned to the scratch schema — the migration runs sandboxed on this. */
let client: PoolClient;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await client.query(sql, params);
  return r.rows as T[];
}

/** Runs the real migration file and returns how many rows it changed. */
async function runForward(): Promise<number> {
  const r = await client.query(FORWARD);
  return r.rowCount ?? 0;
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  // Sandbox: the unqualified names in 503 resolve here and nowhere else.
  await client.query(`SET search_path TO ${SCHEMA}`);

  // Minimal stand-ins carrying only the columns the migration touches.
  await q(`
    CREATE TABLE qa_photo_reviews (
      id serial PRIMARY KEY,
      drop_number varchar(100) NOT NULL,
      project varchar(255),
      whatsapp_message_date timestamptz,
      created_at timestamptz NOT NULL
    )`);
  await q(`
    CREATE TABLE dr_photo_unified_reviews (
      drop_number varchar(100) PRIMARY KEY,
      project varchar(255),
      submitted_date date,
      updated_at timestamptz
    )`);

  await q(`
    INSERT INTO qa_photo_reviews (drop_number, project, whatsapp_message_date, created_at) VALUES
      -- the 2026-08-19 Themb'elihle shape: submitted, but absent from the SOW import
      ('DR3022005', 'Themb''elihle', '2026-08-19 07:17:52+00', '2026-08-19 07:17:55+00'),
      -- already carries a project a human set; must not be touched
      ('DR.ALREADY.SET', 'Themb''elihle', '2026-08-19 08:00:00+00', '2026-08-19 08:00:02+00'),
      -- resubmitted: two rows for one DR, latest wins
      ('DR.RESUBMITTED', 'First Guess', '2026-08-17 06:00:00+00', '2026-08-17 06:00:00+00'),
      ('DR.RESUBMITTED', 'Etwatwa',     '2026-08-19 09:00:00+00', '2026-08-19 09:00:00+00'),
      -- no whatsapp_message_date: submitted_date falls back to created_at
      ('DR.NO.WA.DATE', 'Mamelodi', NULL, '2026-08-19 10:30:00+00'),
      -- submission carries no project: date still fills, project stays NULL
      ('DR.NO.PROJECT', NULL, '2026-08-19 11:00:00+00', '2026-08-19 11:00:00+00')`);

  await q(`
    INSERT INTO dr_photo_unified_reviews (drop_number, project, submitted_date, updated_at) VALUES
      ('DR3022005',      NULL,      NULL,         NULL),
      ('DR.ALREADY.SET', 'Handset', '2026-01-01', NULL),
      ('DR.RESUBMITTED', NULL,      NULL,         NULL),
      ('DR.NO.WA.DATE',  NULL,      NULL,         NULL),
      ('DR.NO.PROJECT',  NULL,      NULL,         NULL),
      -- Velo Test shape: a unified row with no submission behind it at all
      ('DR.NO.SUBMISSION', NULL,    NULL,         NULL)`);
});

afterAll(async () => {
  await client?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  client?.release();
  await pool.end();
});

async function rowOf(dropNumber: string) {
  const rows = await q<{ project: string | null; submitted_date: Date | null }>(
    `SELECT project, submitted_date FROM dr_photo_unified_reviews WHERE drop_number = $1`,
    [dropNumber]
  );
  return rows[0];
}

/** node-postgres returns DATE (OID 1082) as a local-midnight Date — compare as text. */
function dateText(value: Date | null): string | null {
  if (value === null) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('migration 503 — backfill unified reviews project from WhatsApp submission', () => {
  it('fills project for a DR the SOW import never loaded', async () => {
    const changed = await runForward();

    // NULL project + a submission naming one: DR3022005, DR.RESUBMITTED,
    // DR.NO.WA.DATE. Not DR.ALREADY.SET (project set), not DR.NO.PROJECT (its
    // submission names none), not DR.NO.SUBMISSION (no qa_photo_reviews row).
    expect(changed).toBe(3);

    expect((await rowOf('DR3022005'))?.project).toBe("Themb'elihle");
  });

  it('never overwrites a project that was already set', async () => {
    expect((await rowOf('DR.ALREADY.SET'))?.project).toBe('Handset');
  });

  it('leaves a row with no submission behind it untouched', async () => {
    // These are the Velo Test / Integration Test rows. Nothing evidences them,
    // so they stay NULL here and stay excluded by the read queries.
    expect((await rowOf('DR.NO.SUBMISSION'))?.project).toBeNull();
  });

  it('takes the latest submission when a DR was resubmitted', async () => {
    // qa_photo_reviews holds one row per submission. Without ORDER BY the pick
    // would be plan-dependent; with it, the most recent submission wins.
    expect((await rowOf('DR.RESUBMITTED'))?.project).toBe('Etwatwa');
  });

  it('leaves submitted_date alone even where it is NULL', async () => {
    // Deliberately out of scope: the read queries resolve the date as
    // COALESCE(submitted_date, created_at::DATE), and writing this column would
    // move rows onto a different reporting day. Same call migration 473 made.
    expect((await rowOf('DR3022005'))?.submitted_date).toBeNull();
    expect(dateText((await rowOf('DR.ALREADY.SET'))?.submitted_date ?? null)).toBe('2026-01-01');
  });

  it('leaves project NULL when the only submission names no project', async () => {
    // `qa.project IS NOT NULL` in the EXISTS guard, not just the subquery:
    // without it this row matches forever and rewrites NULL over NULL, which is
    // what the idempotency test below would catch.
    expect((await rowOf('DR.NO.PROJECT'))?.project).toBeNull();
  });

  it('is idempotent — a second run changes nothing', async () => {
    const changedAgain = await runForward();
    expect(changedAgain).toBe(0);
  });
});

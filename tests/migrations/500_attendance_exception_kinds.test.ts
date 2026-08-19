if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig500_attendance_exception_kinds_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '500_attendance_exception_kinds.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_500_attendance_exception_kinds.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const PREREQUISITES = `
  CREATE TABLE attendance_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE attendance_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES attendance_entries(id) ON DELETE CASCADE,
    exception_kind VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'warning',
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    details JSONB,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    resolution_note TEXT,
    CONSTRAINT attendance_exceptions_exception_kind_check CHECK (exception_kind::text = ANY (ARRAY[
      'missing_clock_out','geofence_mismatch','clock_skew','out_of_hours',
      'manual_override','duplicate_entry','vehicle_gps_mismatch','forgotten_clock_out_retro'
    ]::text[]))
  );
`;

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
});
afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end(); await admin.end();
});

beforeEach(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await db.query(PREREQUISITES);
  await db.query(`INSERT INTO attendance_entries DEFAULT VALUES`);
  const { rows } = await db.query('SELECT id FROM attendance_entries LIMIT 1');
  const e = rows[0].id;
  await db.query(
    `INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details) VALUES
       ($1,'geofence_mismatch','warning','{"lat":-26.4,"lon":27.8}'::jsonb),
       ($1,'geofence_mismatch','warning','{"lat":-26.5,"lon":27.9}'::jsonb),
       ($1,'geofence_mismatch','info','{"reason":"low_accuracy","accuracy_m":180}'::jsonb),
       ($1,'vehicle_gps_mismatch','warning',NULL),
       ($1,'missing_clock_out','warning',NULL)`, [e]);
  // One already-resolved geofence row: the migration must not touch it.
  await db.query(
    `INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details, resolved_at, resolution_note)
     VALUES ($1,'geofence_mismatch','warning',NULL, now(), 'resolved by a human')`, [e]);
});

const count = async (sql: string, p: unknown[] = []) =>
  Number((await db.query(sql, p)).rows[0].c);

describe('migration 500 — exception kinds', () => {
  it('relabels low-accuracy rows out of geofence_mismatch', async () => {
    await db.query(FORWARD);
    expect(await count(`SELECT count(*) c FROM attendance_exceptions WHERE exception_kind='low_accuracy'`)).toBe(1);
  });

  it('leaves the relabelled low-accuracy row UNRESOLVED — it is a real warning', async () => {
    await db.query(FORWARD);
    // The whole point: a blanket resolve would have wrongly cleared 236 of these.
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE exception_kind='low_accuracy' AND resolved_at IS NOT NULL`
    )).toBe(0);
  });

  it('resolves the false geofence mismatches', async () => {
    await db.query(FORWARD);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE exception_kind='geofence_mismatch' AND resolved_at IS NULL`
    )).toBe(0);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE resolution_note LIKE 'Auto-resolved by migration 500:%'`
    )).toBe(2);
  });

  it('attributes them to nobody — resolved_by stays NULL in an audit table', async () => {
    await db.query(FORWARD);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE resolution_note LIKE 'Auto-resolved%' AND resolved_by IS NOT NULL`
    )).toBe(0);
  });

  it('does not disturb a row a human already resolved', async () => {
    await db.query(FORWARD);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE resolution_note='resolved by a human'`
    )).toBe(1);
  });

  it('leaves unrelated kinds alone', async () => {
    await db.query(FORWARD);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE exception_kind IN ('vehicle_gps_mismatch','missing_clock_out') AND resolved_at IS NULL`
    )).toBe(2);
  });

  it('accepts low_accuracy as a valid kind afterwards, and still rejects nonsense', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query('SELECT id FROM attendance_entries LIMIT 1');
    await expect(db.query(
      `INSERT INTO attendance_exceptions (entry_id, exception_kind) VALUES ($1,'low_accuracy')`, [rows[0].id]
    )).resolves.toBeTruthy();
    await expect(db.query(
      `INSERT INTO attendance_exceptions (entry_id, exception_kind) VALUES ($1,'not_a_kind')`, [rows[0].id]
    )).rejects.toThrow();
  });

  it('rolls back cleanly', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    expect(await count(`SELECT count(*) c FROM attendance_exceptions WHERE exception_kind='low_accuracy'`)).toBe(0);
    expect(await count(
      `SELECT count(*) c FROM attendance_exceptions WHERE exception_kind='geofence_mismatch' AND resolved_at IS NULL`
    )).toBe(3);
    // The human resolution survives the round trip.
    expect(await count(`SELECT count(*) c FROM attendance_exceptions WHERE resolution_note='resolved by a human'`)).toBe(1);
  });
});

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const SCHEMA = 'mig496_fleet_foundations_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '496_fleet_parking_operational_foundations.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_496_fleet_parking_operational_foundations.sql'), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query('CREATE TABLE users (id UUID PRIMARY KEY)');
  await db.query('INSERT INTO users (id) VALUES ($1)', [USER]);
  await db.query(FORWARD);
});

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

async function namedObject(name: string): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = $1
       UNION ALL SELECT 1 FROM pg_indexes WHERE schemaname = $2 AND indexname = $1
     ) AS present`,
    [name, SCHEMA]
  );
  return result.rows[0].present;
}

describe('migration 496', () => {
  it('creates the required constraints and indexes', async () => {
    for (const name of [
      'notification_idempotency_claims_user_event_key_key',
      'fleet_parking_check_runs_status_check',
      'ix_fleet_parking_runs_started_at',
      'ix_fleet_parking_runs_check_date',
    ]) expect(await namedObject(name)).toBe(true);
  });

  it('enforces recipient/event/key uniqueness', async () => {
    const values = [USER, 'fleet.parking_violation', 'parking-violation:veh-1:2026-08-11'];
    await db.query('INSERT INTO notification_idempotency_claims (user_id,event_type,idempotency_key) VALUES ($1,$2,$3)', values);
    await expect(db.query('INSERT INTO notification_idempotency_claims (user_id,event_type,idempotency_key) VALUES ($1,$2,$3)', values))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('allows repeated dates but rejects invalid status', async () => {
    await db.query("INSERT INTO fleet_parking_check_runs (check_date,started_at,status) VALUES ('2026-08-11',now(),'running'),('2026-08-11',now(),'succeeded')");
    await expect(db.query("INSERT INTO fleet_parking_check_runs (check_date,started_at,status) VALUES ('2026-08-11',now(),'invalid')"))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('rolls back only the two owned tables', async () => {
    await db.query(ROLLBACK);
    const result = await db.query("SELECT to_regclass('fleet_parking_check_runs') AS runs, to_regclass('notification_idempotency_claims') AS claims");
    expect(result.rows[0]).toEqual({ runs: null, claims: null });
  });
});

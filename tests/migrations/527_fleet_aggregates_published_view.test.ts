/**
 * Contract for migration 527 (the published aggregates view), against real
 * Postgres.
 *
 * The unit tests beside this one assert what the migration FILE says. That is
 * not the same as asserting what the database does, and the property this view
 * exists for — a superseded generation being unreadable through it — can only
 * be demonstrated by putting a retired row in a table and failing to read it
 * back.
 *
 * That property is load-bearing. `replaceMonth` retires a generation exactly
 * when a month is recomputed, and the case that recomputes a month to fewer
 * rows is the anonymity threshold being RAISED — so the retired rows are
 * precisely the ones that published groups now judged too small. A reader that
 * forgets `AND is_active = true` gets MORE rows, not an error.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PUBLISHED_VIEW_COLUMNS } from '@/modules/fleet/incidents/analytics/aggregateSchema';

const SCHEMA = 'mig527_published_view_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const DRIVER_INPUT = readFileSync(join(SQL_DIR, '511_fleet_incident_driver_input.sql'), 'utf8');
const RETENTION = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '527_fleet_aggregates_published_view.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_527_fleet_aggregates_published_view.sql'), 'utf8');

const VIEW = 'fleet_operational_monthly_aggregates_published';
const BASE_TABLE = 'fleet_operational_monthly_aggregates';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';

/**
 * Everything migrations 510, 511 and 518 expect to already exist.
 *
 * This block used to be a shorter guess at that list, and it was wrong in a way
 * a clean database catches and a developer's database does not: 510 and 518 both
 * INSERT into `access_permissions` and `role_permissions`, so on a scratch schema
 * `beforeAll` failed with `relation "access_permissions" does not exist` and
 * every test in the file errored before it ran. Kept in step with 518's own
 * block, which is the one that has to stay true.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration TEXT);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  CREATE TABLE attendance_adjustments (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type VARCHAR(20) NOT NULL, key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100), label VARCHAR(100) NOT NULL, description TEXT, route VARCHAR(200),
    sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL, UNIQUE (role, permission_key)
  );
  CREATE TABLE user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
    permission_key VARCHAR(100) NOT NULL, override_type VARCHAR(10) NOT NULL, actions JSONB NOT NULL,
    UNIQUE (user_id, permission_key)
  );
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-527@example.test');
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Migration Test Staff');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('${SITE}');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

/** One storable aggregate row. `contributor_count` clears the table's CHECK. */
async function insertAggregate(monthStart: string, metricKey: string, numerator: number, isActive: boolean): Promise<void> {
  await db.query(
    `INSERT INTO ${BASE_TABLE}
       (metric_version, month_start, dimension_level, metric_key, metric_kind,
        numerator, denominator, contributor_count, is_active)
     VALUES (1, $1::date, 'organisation', $2, 'count', $3, NULL, 7, $4)`,
    [monthStart, metricKey, numerator, isActive],
  );
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(DRIVER_INPUT);
  await db.query(RETENTION);
}, 120_000);

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(ROLLBACK);
  await db.query(`DELETE FROM ${BASE_TABLE}`);
});

describe('the view exists only once its migration runs', () => {
  it('is absent beforehand, so a read path cannot silently predate it', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`,
      [SCHEMA, VIEW],
    );
    expect(rows).toHaveLength(0);
  });

  it('is created by the forward migration', async () => {
    await db.query(FORWARD);
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`,
      [SCHEMA, VIEW],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('what the view actually returns', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('hides a superseded generation — the property the view exists for', async () => {
    await insertAggregate('2026-01-01', 'incident.late', 5, true);
    await insertAggregate('2026-01-01', 'incident.wrong_site', 99, false);

    const base = await db.query(`SELECT metric_key FROM ${BASE_TABLE} ORDER BY metric_key`);
    const published = await db.query(`SELECT metric_key FROM ${VIEW} ORDER BY metric_key`);

    // The retired row is in the table and must not be in the view.
    expect(base.rows.map((row) => row.metric_key)).toEqual(['incident.late', 'incident.wrong_site']);
    expect(published.rows.map((row) => row.metric_key)).toEqual(['incident.late']);
  });

  it('cannot be talked past with an is_active predicate of the caller own', async () => {
    await insertAggregate('2026-02-01', 'incident.late', 5, false);
    const { rows } = await db.query(`SELECT metric_key FROM ${VIEW} WHERE is_active = false`);
    expect(rows).toHaveLength(0);
  });

  it('exposes exactly the published column list, in order', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [SCHEMA, VIEW],
    );
    // The VIEW's columns, which are a strict subset of the table's.
    expect(rows.map((row) => row.column_name)).toEqual([...PUBLISHED_VIEW_COLUMNS]);
  });

  it('is a security barrier in the database, not only in the file', async () => {
    const { rows } = await db.query<{ reloptions: string[] | null }>(
      `SELECT c.reloptions FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [SCHEMA, VIEW],
    );
    expect(rows[0]?.reloptions ?? []).toContain('security_barrier=true');
  });

  it('is readable by the application role', async () => {
    const { rows } = await db.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = $1 AND table_name = $2 AND grantee = 'fibreflow_user'`,
      [SCHEMA, VIEW],
    );
    expect(rows.map((row) => row.privilege_type)).toContain('SELECT');
  });
});

describe('rollback', () => {
  it('removes the view and leaves every row of the table behind', async () => {
    await db.query(FORWARD);
    await insertAggregate('2026-03-01', 'incident.late', 5, true);
    await insertAggregate('2026-03-01', 'incident.wrong_site', 99, false);

    await db.query(ROLLBACK);

    const views = await db.query(
      `SELECT 1 FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`,
      [SCHEMA, VIEW],
    );
    expect(views.rows).toHaveLength(0);
    const { rows } = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${BASE_TABLE}`);
    expect(Number(rows[0]?.count)).toBe(2);
  });

  it('is repeatable, so a half-applied rollback can be finished', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    await expect(db.query(ROLLBACK)).resolves.toBeDefined();
  });
});

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SCHEMA = 'mig498_fleet_operational_status_rules_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '498_fleet_operational_status_rules.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_498_fleet_operational_status_rules.sql'), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-498@example.test');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

async function insertRule(overrides: Record<string, unknown> = {}): Promise<void> {
  const values = {
    version: 2, timezone: 'Africa/Johannesburg', effectiveFrom: '2099-01-01T00:00:00.000Z', effectiveTo: null,
    monitoringBefore: 60, monitoringAfter: 60, arrivalDwell: 5, wrongSite: 5, earlyDeparture: 10,
    approachingDistance: 10_000, approachingReadings: 2, minimumSpeed: 5, mismatchTolerance: 250,
    ...overrides,
  };
  await db.query(
    `INSERT INTO fleet_operational_status_rules (
       version, timezone, effective_from, effective_to, monitoring_before_minutes, monitoring_after_minutes,
       arrival_dwell_minutes, wrong_site_confirmation_minutes, early_departure_confirmation_minutes,
       approaching_distance_meters, approaching_min_readings, minimum_moving_speed_kmh,
       evidence_mismatch_tolerance_meters, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [values.version, values.timezone, values.effectiveFrom, values.effectiveTo, values.monitoringBefore,
      values.monitoringAfter, values.arrivalDwell, values.wrongSite, values.earlyDeparture,
      values.approachingDistance, values.approachingReadings, values.minimumSpeed, values.mismatchTolerance, USER]
  );
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public, not the scratch schema — see the note in
  // 497_fleet_operational_assignments.test.ts. Installing btree_gist into a
  // scratch schema ties the extension's lifetime to this file's
  // `DROP SCHEMA ... CASCADE` and breaks whichever sibling runs next.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});
beforeEach(async () => {
  await db.query('DELETE FROM fleet_operational_status_rules WHERE version > 1');
  await db.query('UPDATE fleet_operational_status_rules SET effective_to = NULL WHERE version = 1');
});

describe('migration 498 operational status rules', () => {
  it('seeds the approved initial rule values', async () => {
    const { rows } = await db.query(`SELECT version, timezone, monitoring_before_minutes, monitoring_after_minutes,
      arrival_dwell_minutes, wrong_site_confirmation_minutes, early_departure_confirmation_minutes,
      approaching_distance_meters, approaching_min_readings, minimum_moving_speed_kmh,
      evidence_mismatch_tolerance_meters FROM fleet_operational_status_rules`);
    expect(rows).toEqual([{
      version: 1, timezone: 'Africa/Johannesburg', monitoring_before_minutes: 60, monitoring_after_minutes: 60,
      arrival_dwell_minutes: 5, wrong_site_confirmation_minutes: 5, early_departure_confirmation_minutes: 10,
      approaching_distance_meters: 10000, approaching_min_readings: 2,
      // NUMERIC, and node-postgres returns NUMERIC as a string to preserve
      // precision. Production accounts for this: RuleRow types the field
      // `number | string` and mapRule coerces it with Number(). Asserting the
      // driver's real shape here rather than casting keeps that contract pinned.
      minimum_moving_speed_kmh: '5.00',
      evidence_mismatch_tolerance_meters: 250,
    }]);
  });

  it('enforces threshold checks and actor identity', async () => {
    await expect(insertRule({ monitoringBefore: -1 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertRule({ approachingDistance: 0 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertRule({ approachingReadings: 1 })).rejects.toMatchObject({ code: '23514' });
    // The actor FK is only reachable once every CHECK passes and the row does
    // not trip the one-open-version exclusion: approaching_min_readings must be
    // >= 2, and version 1 has to be closed first so a second open version is not
    // what fails. With `1` readings this asserted 23503 but actually raised the
    // approaching_positive CHECK, so the FK was never exercised.
    await db.query("UPDATE fleet_operational_status_rules SET effective_to = '2098-01-01T00:00:00.000Z' WHERE version = 1");
    await expect(db.query(`INSERT INTO fleet_operational_status_rules (version, timezone, effective_from,
      monitoring_before_minutes, monitoring_after_minutes, arrival_dwell_minutes, wrong_site_confirmation_minutes,
      early_departure_confirmation_minutes, approaching_distance_meters, approaching_min_readings,
      minimum_moving_speed_kmh, evidence_mismatch_tolerance_meters, created_by) VALUES
      (3,'Africa/Johannesburg','2099-01-01',1,1,1,1,1,1,2,0,0,'00000000-0000-4000-8000-000000000000')`))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('enforces unique positive versions, range exclusion, and one open version', async () => {
    await expect(insertRule({ version: 1, effectiveFrom: '2100-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: '23505' });
    await expect(insertRule({ effectiveFrom: '2099-01-01T00:00:00.000Z', effectiveTo: '2100-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: '23P01' });
    await expect(insertRule({ effectiveFrom: '2099-01-01T00:00:00.000Z', effectiveTo: null })).rejects.toMatchObject({ code: '23P01' });
    await expect(insertRule({ version: 0, effectiveFrom: '2200-01-01T00:00:00.000Z', effectiveTo: '2200-02-01T00:00:00.000Z' })).rejects.toMatchObject({ code: '23514' });
    await db.query("UPDATE fleet_operational_status_rules SET effective_to = '2099-01-01T00:00:00.000Z' WHERE version = 1");
    await expect(insertRule({ effectiveFrom: '2099-01-01T00:00:00.000Z', effectiveTo: '2100-01-01T00:00:00.000Z' })).resolves.toBeUndefined();
  });

  it('registers status and rules permissions under Fleet with restricted rule editing', async () => {
    const { rows } = await db.query<{ key: string; parent_key: string; role: string; actions: { view: boolean; edit: boolean } }>(
      `SELECT p.key, p.parent_key, r.role, r.actions FROM access_permissions p
       JOIN role_permissions r ON r.permission_key = p.key
       WHERE p.key IN ('fleet.operations-status', 'fleet.operations-rules') ORDER BY p.key, r.role`
    );
    expect(rows.every((row) => row.parent_key === 'fleet')).toBe(true);
    expect(rows.filter((row) => row.key === 'fleet.operations-status').map((row) => row.role))
      .toEqual(['admin', 'manager', 'project_manager', 'super_admin', 'viewer']);
    expect(rows.filter((row) => row.key === 'fleet.operations-rules').map((row) => row.role))
      .toEqual(['admin', 'super_admin']);
    expect(rows.filter((row) => row.key === 'fleet.operations-rules').every((row) => row.actions.edit)).toBe(true);
  });

  it('rolls back only PR 4 rules and permission rows', async () => {
    await db.query(`INSERT INTO schema_migrations (filename) VALUES ('498_fleet_operational_status_rules.sql')`);
    await db.query(`INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
      VALUES ($1, 'fleet.operations-rules', 'grant', '{"edit":true}')`, [USER]);
    await db.query(ROLLBACK);
    const { rows } = await db.query(`SELECT to_regclass('fleet_operational_status_rules') AS rules`);
    expect(rows[0]).toEqual({ rules: null });
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet'`)).resolves.toBeDefined();
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key IN ('fleet.operations-status', 'fleet.operations-rules')`)).resolves.toMatchObject({ rows: [] });
  });
});

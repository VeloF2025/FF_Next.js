/**
 * Migration 529 against real Postgres.
 *
 * Three of these assertions cannot be made any other way.
 *
 *   1. The WhatsApp gate. Migration 510 seeded all six telematics incident
 *      types `critical` + `whatsapp_enabled`, and `requiresMandatoryIncident-
 *      WhatsApp` is `severity === 'critical' && producerKind === 'source_event'`.
 *      If 529's re-versioning does not actually land, PR4's detectors blast a
 *      WhatsApp per harsh-braking event. Reading the SQL cannot tell you whether
 *      the UPDATE matched any row.
 *   2. `after_hours_exempt` defaults false on rows that ALREADY EXIST. A
 *      `DEFAULT false` on an ALTER is not the same statement as a backfill, and
 *      the detector reads the column on production rows written years ago.
 *   3. Concurrency. The one-open partial unique index and the gist exclusion are
 *      the enforcement; `createVehicleRuleVersion`'s FOR UPDATE only makes the
 *      loser lose cleanly. A unit test with a stubbed client is structurally
 *      blind to both.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { REVERSIONED_TELEMATICS_INCIDENT_TYPES, TELEMATICS_REVERSION_CHANGE_REASON } from '@/modules/fleet/vehicleDetectors/types';

const SCHEMA = 'mig529_fleet_vehicle_operational_rules_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '529_fleet_vehicle_operational_rules.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_529_fleet_vehicle_operational_rules.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const VEHICLE = '55555555-5555-4555-8555-555555555555';
/** Every open incident rule 510 seeds — the count 529 must leave unchanged. */
const SEEDED_OPEN_RULE_COUNT = 14;

/**
 * 510's rule seed, lifted verbatim out of its own file.
 *
 * Every test starts from exactly this state. The scenario tests below leave
 * operator-authored rows behind that the rollback deliberately does NOT remove,
 * so resetting has to mean "back to 510", not "run the rollback".
 */
const SEED_RULES = (() => {
  const from = INCIDENTS.indexOf('INSERT INTO fleet_operational_incident_rules');
  if (from < 0) throw new Error('510 no longer seeds fleet_operational_incident_rules');
  return INCIDENTS.slice(from, INCIDENTS.indexOf(';', from) + 1);
})();

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 4 });

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration TEXT);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-529@example.test');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

/**
 * Block until a backend is actually waiting on a lock.
 *
 * Firing a statement and committing immediately is a race: an unsent statement
 * takes its snapshot AFTER the commit, sees the new open version, and the test
 * passes for the wrong reason.
 */
async function waitForLockWaiter(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active' AND datname = current_database()`,
    );
    if (rows[0] && rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('No backend ever queued on the row lock');
}

async function openIncidentRules(): Promise<Array<{ incident_type: string; version: number; severity: string; whatsapp_enabled: boolean; immediate_notification: boolean; include_in_morning_summary: boolean }>> {
  const { rows } = await db.query(
    `SELECT incident_type, version, severity, whatsapp_enabled, immediate_notification, include_in_morning_summary
       FROM fleet_operational_incident_rules WHERE effective_to IS NULL ORDER BY incident_type`,
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public, not the scratch schema: installing btree_gist INTO the
  // scratch schema ties its lifetime to this file's DROP SCHEMA ... CASCADE and
  // breaks whichever sibling migration test runs next.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
}, 120_000);

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Return to the pre-529 world, then re-seed the vehicle row so every test
  // that reads after_hours_exempt is reading a row that PREDATES the ALTER.
  await db.query(ROLLBACK);
  await db.query('DELETE FROM fleet_operational_incident_rules');
  await db.query(SEED_RULES);
  await db.query('DELETE FROM fleet_vehicles');
  await db.query(`INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', 'CA 123-456')`);
});

/**
 * Stand in for an operator who edited a rule through the incident-settings UI:
 * close whatever is open for `type` and open a new version at `version`.
 */
async function operatorVersion(type: string, version: number, severity: string): Promise<void> {
  // One dedicated client: a BEGIN issued on the POOL can land on a different
  // connection from the statements that follow it.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE fleet_operational_incident_rules SET effective_to = now() WHERE incident_type = $1 AND effective_to IS NULL',
      [type],
    );
    await client.query(
      `INSERT INTO fleet_operational_incident_rules
         (incident_type, version, effective_from, creates_incident, severity, immediate_notification,
          in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
          acknowledgement_target_minutes, change_reason)
       VALUES ($1, $2, now(), true, $3, true, true, true, true, false, 5, 'Operator edit')`,
      [type, version, severity],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/** A closed version that sits entirely BEFORE the open one — history, not a conflict. */
async function closedHistoricVersion(type: string, version: number): Promise<void> {
  await db.query(
    `INSERT INTO fleet_operational_incident_rules
       (incident_type, version, effective_from, effective_to, creates_incident, severity,
        immediate_notification, in_app_enabled, email_enabled, whatsapp_enabled,
        include_in_morning_summary, acknowledgement_target_minutes)
     VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 hour', true, 'critical',
             true, true, true, true, false, 5)`,
    [type, version],
  );
}

async function openRuleFor(type: string) {
  const open = await openIncidentRules();
  return open.find((row) => row.incident_type === type);
}

describe('before the migration runs', () => {
  it('leaves all six telematics rules critical with WhatsApp armed', async () => {
    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      const rule = open.find((row) => row.incident_type === type);
      expect(rule, type).toMatchObject({ version: 1, severity: 'critical', whatsapp_enabled: true });
    }
  });

  it('has no vehicle rule table and no after_hours_exempt column', async () => {
    const table = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'fleet_vehicle_operational_rules'`,
      [SCHEMA],
    );
    expect(table.rows).toHaveLength(0);
    const column = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'fleet_vehicles' AND column_name = 'after_hours_exempt'`,
      [SCHEMA],
    );
    expect(column.rows).toHaveLength(0);
  });
});

describe('the forward migration', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('is repeatable', async () => {
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    const { rows } = await db.query('SELECT count(*)::int AS count FROM fleet_vehicle_operational_rules');
    expect(rows[0].count).toBe(1);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('seeds version 1 with the PR0-measured thresholds', async () => {
    const { rows } = await db.query(
      `SELECT version, timezone, after_hours_start_time::text AS start_time, after_hours_end_time::text AS end_time,
              weekends_are_after_hours, public_holidays_are_after_hours, theft_displacement_meters,
              theft_min_positions, harsh_linear_g::text AS linear_g, harsh_lateral_g::text AS lateral_g,
              harsh_min_speed_kph::text AS min_speed, speed_over_limit_kph::text AS over_limit,
              unauthorized_stop_minutes, lost_contact_minutes, idle_alert_minutes, known_site_radius_meters,
              effective_to
         FROM fleet_vehicle_operational_rules`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1, timezone: 'Africa/Johannesburg', start_time: '18:00:00', end_time: '06:00:00',
      weekends_are_after_hours: true, public_holidays_are_after_hours: true,
      theft_displacement_meters: 500, theft_min_positions: 2,
      linear_g: '0.350', lateral_g: '0.350', min_speed: '20.00', over_limit: '15.00',
      unauthorized_stop_minutes: 45, lost_contact_minutes: 30, idle_alert_minutes: 20,
      known_site_radius_meters: 500, effective_to: null,
    });
  });

  it('defaults after_hours_exempt to false on a row that predates the column', async () => {
    const { rows } = await db.query('SELECT after_hours_exempt FROM fleet_vehicles WHERE id = $1', [VEHICLE]);
    expect(rows[0].after_hours_exempt).toBe(false);
  });

  it('leaves exactly 14 open incident rules, four of them re-versioned to high', async () => {
    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({
        version: 2, severity: 'high', whatsapp_enabled: false,
        immediate_notification: false, include_in_morning_summary: true,
      });
    }
  });

  it('leaves the two emergency types critical and on WhatsApp', async () => {
    const open = await openIncidentRules();
    for (const type of ['accident_sos', 'theft_after_hours_movement']) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({
        version: 1, severity: 'critical', whatsapp_enabled: true, immediate_notification: true,
      });
    }
  });

  it('keeps version 1 of the re-versioned types as closed history, not deleted', async () => {
    const { rows } = await db.query(
      `SELECT incident_type FROM fleet_operational_incident_rules
        WHERE version = 1 AND effective_to IS NOT NULL ORDER BY incident_type`,
    );
    expect(rows.map((row) => row.incident_type)).toEqual([...REVERSIONED_TELEMATICS_INCIDENT_TYPES].sort());
  });

  it('creates exactly the fleet.vehicle-rules permission, for admins only', async () => {
    const permission = await db.query(
      `SELECT key, parent_key, route FROM access_permissions WHERE key = 'fleet.vehicle-rules'`,
    );
    expect(permission.rows).toHaveLength(1);
    expect(permission.rows[0]).toMatchObject({ parent_key: 'fleet', route: '/fleet/assignments' });
    const roles = await db.query(
      `SELECT role, actions FROM role_permissions WHERE permission_key = 'fleet.vehicle-rules' ORDER BY role`,
    );
    expect(roles.rows.map((row) => row.role)).toEqual(['admin', 'super_admin']);
    for (const row of roles.rows) {
      expect(row.actions).toMatchObject({ view: true, create: true, edit: true, delete: false });
    }
  });
});

describe('a database an operator has already edited', () => {
  // The first shape of this migration pinned the close and the insert to
  // `version = 1`. Every test in this block failed against it — silently, with
  // the migration exiting 0 and the type left critical with WhatsApp armed.

  it('re-versions on top of an operator open version 2, at version 3', async () => {
    await operatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);

    expect(await openRuleFor('severe_driving')).toMatchObject({
      version: 3, severity: 'high', whatsapp_enabled: false,
      immediate_notification: false, include_in_morning_summary: true,
    });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('steps past a CLOSED version 2 instead of colliding with it', async () => {
    // A hard-coded version 2 raises 23505 here, or — with ON CONFLICT DO
    // NOTHING — inserts nothing and leaves the type with ZERO open rules, which
    // makes the incident producer throw for every incident of that type.
    await closedHistoricVersion('dangerous_area_entry', 2);
    await db.query(FORWARD);

    expect(await openRuleFor('dangerous_area_entry')).toMatchObject({ version: 3, severity: 'high' });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('leaves an operator deliberate non-critical version completely alone', async () => {
    // The close is scoped by severity, so a type an operator has already taken
    // off critical is not re-versioned on top of. Their row stays open.
    await operatorVersion('lost_contact_moving', 2, 'normal');
    await db.query(FORWARD);

    expect(await openRuleFor('lost_contact_moving')).toMatchObject({ version: 2, severity: 'normal' });
    const authored = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM fleet_operational_incident_rules
        WHERE incident_type = 'lost_contact_moving' AND change_reason = $1`,
      [TELEMATICS_REVERSION_CHANGE_REASON],
    );
    expect(authored.rows[0]!.count).toBe(0);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('is a no-op on a second run, whatever the starting state', async () => {
    await operatorVersion('severe_driving', 2, 'critical');
    await closedHistoricVersion('dangerous_area_entry', 2);
    await operatorVersion('lost_contact_moving', 2, 'normal');
    await db.query(FORWARD);
    const afterFirst = await openIncidentRules();

    await db.query(FORWARD);

    expect(await openIncidentRules()).toEqual(afterFirst);
    expect(afterFirst).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('never leaves a type with zero or two open rules', async () => {
    await operatorVersion('severe_driving', 2, 'critical');
    await closedHistoricVersion('dangerous_area_entry', 2);
    await db.query(FORWARD);

    const counts = await db.query<{ incident_type: string; count: number }>(
      `SELECT incident_type, count(*)::int AS count FROM fleet_operational_incident_rules
        WHERE effective_to IS NULL GROUP BY incident_type ORDER BY incident_type`,
    );
    expect(counts.rows).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const row of counts.rows) expect(row.count, row.incident_type).toBe(1);
  });
});

describe('the constraints the database enforces', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('rejects a second open version through the gist exclusion', async () => {
    // Two open rows both run to 'infinity', so they always overlap. The gist
    // constraint is what an ordinary duplicate hits first.
    await expect(db.query(
      `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
       VALUES (2, 'Africa/Johannesburg', now() + interval '1 day')`,
    )).rejects.toMatchObject({ code: '23P01' });
  });

  it('still rejects a second open version with the gist exclusion removed — the one-open index', async () => {
    // The two guards shadow each other, so the index can only be exercised on
    // its own. Without this, deleting ux_..._one_open leaves every other test
    // green and the table one dropped constraint away from two effective rules.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE fleet_vehicle_operational_rules DROP CONSTRAINT fleet_vehicle_operational_rules_no_overlap');
      await expect(client.query(
        `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
         VALUES (2, 'Africa/Johannesburg', now() + interval '1 day')`,
      )).rejects.toMatchObject({ code: '23505' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects an overlapping closed range through the gist exclusion', async () => {
    await db.query(
      `UPDATE fleet_vehicle_operational_rules SET effective_to = now() + interval '10 days' WHERE version = 1`,
    );
    // Starts a day before version 1 closes: an overlap, and a period in which
    // two different threshold sets would both claim to be effective.
    await expect(db.query(
      `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from, effective_to)
       VALUES (2, 'Africa/Johannesburg', now() + interval '9 days', now() + interval '20 days')`,
    )).rejects.toMatchObject({ code: '23P01' });
  });

  it('accepts a version that starts exactly when the previous one closes', async () => {
    // The range is half-open, so meeting endpoints are not an overlap. This is
    // precisely the shape createVehicleRuleVersion writes, and the reason 529
    // needs no explicit BEGIN: one transaction, one now().
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE fleet_vehicle_operational_rules SET effective_to = now() WHERE effective_to IS NULL');
      await expect(client.query(
        `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
         VALUES (2, 'Africa/Johannesburg', now())`,
      )).resolves.toBeTruthy();
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const { rows } = await db.query('SELECT count(*)::int AS count FROM fleet_vehicle_operational_rules');
    expect(rows[0].count).toBe(2);
  });

  it.each([
    ['a single-position theft threshold', 'theft_min_positions = 1'],
    ['a zero displacement', 'theft_displacement_meters = 0'],
    ['a negative g threshold', 'harsh_linear_g = -0.1'],
    ['a zero stop window', 'unauthorized_stop_minutes = 0'],
    ['a blank change reason', "change_reason = '  '"],
  ])('rejects %s', async (_label, assignment) => {
    await expect(db.query(`UPDATE fleet_vehicle_operational_rules SET ${assignment} WHERE version = 1`))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('lets only one of two concurrent version creations win', async () => {
    const first = await db.connect();
    const second = await db.connect();
    try {
      await first.query('BEGIN');
      await first.query('SELECT id FROM fleet_vehicle_operational_rules WHERE effective_to IS NULL FOR UPDATE');
      await first.query('UPDATE fleet_vehicle_operational_rules SET effective_to = now() WHERE effective_to IS NULL');
      await first.query(
        `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
         VALUES (2, 'Africa/Johannesburg', now())`,
      );

      // The second caller queues on the ROW LOCK — not on anything the
      // application does. Waited for explicitly, because firing the query and
      // committing immediately is a race: if the second statement has not
      // reached the server yet it takes its snapshot after the commit and the
      // test proves nothing.
      await second.query('BEGIN');
      const blocked = second.query('SELECT id FROM fleet_vehicle_operational_rules WHERE effective_to IS NULL FOR UPDATE');
      await waitForLockWaiter();
      await first.query('COMMIT');
      const rows = await blocked;

      // Under READ COMMITTED the unblocked SELECT re-applies its qualifier to
      // the now-closed row and skips it — so the loser sees no open version and
      // createVehicleRuleVersion raises "No open vehicle operational rule".
      expect(rows.rowCount).toBe(0);
      // And had it pressed on regardless, the version UNIQUE stops the duplicate.
      await expect(second.query(
        `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
         VALUES (2, 'Africa/Johannesburg', now())`,
      )).rejects.toMatchObject({ code: '23505' });
      await second.query('ROLLBACK');

      const open = await db.query('SELECT version FROM fleet_vehicle_operational_rules WHERE effective_to IS NULL');
      expect(open.rows).toEqual([{ version: 2 }]);
    } finally {
      first.release();
      second.release();
    }
  });
});

describe('the grants the application actually runs with', () => {
  beforeEach(async () => { await db.query(FORWARD); });

  it('lets fibreflow_user read, insert and update the rule — and not delete it', async () => {
    // Migration tests run as superuser, which hides a missing grant entirely.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET ROLE fibreflow_user');
      await expect(client.query('SELECT version FROM fleet_vehicle_operational_rules')).resolves.toBeTruthy();
      await expect(client.query(
        'UPDATE fleet_vehicle_operational_rules SET effective_to = now() WHERE effective_to IS NULL',
      )).resolves.toBeTruthy();
      await expect(client.query(
        `INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
         VALUES (2, 'Africa/Johannesburg', now())`,
      )).resolves.toBeTruthy();
      // Rule history is operational evidence. The app must not be able to erase it.
      await expect(client.query('DELETE FROM fleet_vehicle_operational_rules WHERE version = 2'))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('the rollback', () => {
  it('restores version 1 as the open rule for all four re-versioned types', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({
        version: 1, severity: 'critical', whatsapp_enabled: true,
      });
    }
    // No orphan version 2 rows left behind to collide with a re-apply.
    const leftovers = await db.query('SELECT count(*)::int AS count FROM fleet_operational_incident_rules WHERE version = 2');
    expect(leftovers.rows[0].count).toBe(0);
  });

  it('removes the table, the column and the permission rows', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const table = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'fleet_vehicle_operational_rules'`,
      [SCHEMA],
    );
    expect(table.rows).toHaveLength(0);
    const column = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'fleet_vehicles' AND column_name = 'after_hours_exempt'`,
      [SCHEMA],
    );
    expect(column.rows).toHaveLength(0);
    const permission = await db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet.vehicle-rules'`);
    expect(permission.rows).toHaveLength(0);
  });

  it('leaves the migration re-appliable', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    expect(open.find((row) => row.incident_type === 'severe_driving')).toMatchObject({ version: 2, severity: 'high' });
  });

  it('restores an operator version 2, not version 1', async () => {
    await operatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    // 529 closed the operator's row, so that is the row the rollback owes back.
    expect(await openRuleFor('severe_driving')).toMatchObject({
      version: 2, severity: 'critical', whatsapp_enabled: true,
    });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('restores version 1 when a closed version 2 sits in the history', async () => {
    await closedHistoricVersion('dangerous_area_entry', 2);
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    expect(await openRuleFor('dangerous_area_entry')).toMatchObject({ version: 1, severity: 'critical' });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('never deletes a version 2 it did not author', async () => {
    await operatorVersion('severe_driving', 2, 'normal');
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    const rows = await db.query<{ version: number; severity: string }>(
      `SELECT version, severity FROM fleet_operational_incident_rules
        WHERE incident_type = 'severe_driving' ORDER BY version`,
    );
    expect(rows.rows).toEqual([
      { version: 1, severity: 'critical' },
      { version: 2, severity: 'normal' },
    ]);
    expect(await openRuleFor('severe_driving')).toMatchObject({ version: 2, severity: 'normal' });
  });

  it('is idempotent — a second rollback changes nothing', async () => {
    await operatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const afterFirst = await openIncidentRules();

    await db.query(ROLLBACK);

    expect(await openIncidentRules()).toEqual(afterFirst);
    expect(afterFirst).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });
});

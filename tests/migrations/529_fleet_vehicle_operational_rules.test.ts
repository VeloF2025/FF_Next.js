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
import {
  REVERSIONED_TELEMATICS_INCIDENT_TYPES,
  TELEMATICS_REVERSION_CHANGE_REASON,
  telematicsPendingMarker,
} from '@/modules/fleet/vehicleDetectors/types';

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
const DELETE_ONLY_ROLE = 'mig529_delete_only';

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
  // A role that may read and DELETE incident rules but not UPDATE them. It
  // exists to make the rollback's third statement fail after its second has
  // already run — the exact shape that strands four incident types.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DELETE_ONLY_ROLE}') THEN
      CREATE ROLE ${DELETE_ONLY_ROLE} NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${DELETE_ONLY_ROLE}`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(`GRANT SELECT, DELETE ON fleet_operational_incident_rules TO ${DELETE_ONLY_ROLE}`);
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

/**
 * A PENDING open version — activation in the future.
 *
 * This is the ONLY kind the incident-settings dialog can create: its minimum
 * activation is now + 5 minutes. Closing whatever was open first, exactly as the
 * dialog's own transaction does.
 */
interface RuleFlags { whatsappEnabled: boolean; immediateNotification: boolean; includeInMorningSummary: boolean }

/** 510's shape for the four telematics types. A fixture that only ever uses THIS cannot catch a seed-constant restore. */
const SEED_FLAGS: RuleFlags = { whatsappEnabled: true, immediateNotification: true, includeInMorningSummary: false };

async function pendingOperatorVersion(
  type: string,
  version: number,
  severity: string,
  reason: string | null = 'Operator edit',
  flags: RuleFlags = SEED_FLAGS,
  activateIn = '30 minutes',
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE fleet_operational_incident_rules SET effective_to = now() + $2::interval
        WHERE incident_type = $1 AND effective_to IS NULL`,
      [type, activateIn],
    );
    await client.query(
      `INSERT INTO fleet_operational_incident_rules
         (incident_type, version, effective_from, creates_incident, severity, immediate_notification,
          in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
          acknowledgement_target_minutes, change_reason)
       VALUES ($1, $2, now() + $8::interval, true, $3, $5, true, true, $6, $7, 5, $4)`,
      [type, version, severity, reason,
        flags.immediateNotification, flags.whatsappEnabled, flags.includeInMorningSummary, activateIn],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

async function ruleRow(type: string) {
  const { rows } = await db.query(
    `SELECT version, severity, whatsapp_enabled, immediate_notification, include_in_morning_summary,
            change_reason, effective_to, effective_from > now() AS pending
       FROM fleet_operational_incident_rules
      WHERE incident_type = $1 AND effective_to IS NULL`,
    [type],
  );
  return rows[0];
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

/**
 * Split a migration file into its statements, respecting `$$` dollar-quoting.
 *
 * Sent SEPARATELY, which is the whole point: a multi-statement simple query is
 * wrapped in an implicit transaction by Postgres, so running a file as one
 * `query()` is atomic whether or not it contains a BEGIN — and a test that does
 * that cannot tell the two apart. `psql -f` sends them one at a time.
 */
function splitStatements(sql: string): string[] {
  const body = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  for (let index = 0; index < body.length; index += 1) {
    if (body.startsWith('$$', index)) {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      index += 1;
      continue;
    }
    const character = body[index]!;
    if (character === ';' && !inDollarQuote) {
      statements.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) => statement.length > 0);
}

/** The forward migration as psql -f would send it. */
function forwardStatements(): string[] {
  return splitStatements(FORWARD);
}

function rollbackStatements({ withTransaction }: { withTransaction: boolean }): string[] {
  const statements = splitStatements(ROLLBACK);
  return withTransaction ? statements : statements.filter((s) => !/^(BEGIN|COMMIT)$/i.test(s));
}

async function runStatements(client: { query: (text: string) => Promise<unknown> }, statements: string[]): Promise<void> {
  for (const statement of statements) await client.query(statement);
}

/** How many rows migration 529 authored are still present. */
async function authoredCount(type?: string): Promise<number> {
  const rows = type
    ? await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM fleet_operational_incident_rules
        WHERE change_reason = $1 AND incident_type = $2`, [TELEMATICS_REVERSION_CHANGE_REASON, type])
    : await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM fleet_operational_incident_rules WHERE change_reason = $1`,
      [TELEMATICS_REVERSION_CHANGE_REASON]);
  return rows.rows[0]!.count;
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

  it('grants fleet.vehicle-stats view to every reading role', async () => {
    const permission = await db.query(
      `SELECT key, parent_key, route FROM access_permissions WHERE key = 'fleet.vehicle-stats'`,
    );
    expect(permission.rows).toHaveLength(1);
    expect(permission.rows[0]).toMatchObject({ parent_key: 'fleet', route: '/fleet/vehicles' });
    const roles = await db.query(
      `SELECT role, actions FROM role_permissions WHERE permission_key = 'fleet.vehicle-stats' ORDER BY role`,
    );
    expect(roles.rows.map((row) => row.role)).toEqual([
      'admin', 'manager', 'project_manager', 'super_admin', 'viewer',
    ]);
    for (const row of roles.rows) {
      // Read-only: PR6's stats page shows telematics history, it never edits it.
      expect(row.actions).toMatchObject({ view: true, create: false, edit: false, delete: false });
    }
  });

  it('keeps fleet.vehicle-rules to admins, because it arms and disarms detectors', async () => {
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

describe('a type whose open rule is PENDING, not yet effective', () => {
  // The incident-settings dialog cannot create anything else: its minimum
  // activation is now + 5 minutes. `SET effective_to = now()` on such a row is
  // earlier than its own effective_from and violates
  // fleet_operational_incident_rules_range_order — which aborts the deploy
  // under the runner, and half-applies at rc=0 under `psql -f`.

  async function applyForwardSplit(): Promise<void> {
    const client = await db.connect();
    try {
      for (const statement of forwardStatements()) await client.query(statement);
    } finally {
      client.release();
    }
  }

  it('applies at all — the runner path does not abort', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
  });

  it('re-versions the pending row in place, leaving it pending and still the only open row', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);

    const row = await ruleRow('severe_driving');
    expect(row).toMatchObject({
      version: 2, severity: 'high', whatsapp_enabled: false,
      immediate_notification: false, include_in_morning_summary: true,
      pending: true, effective_to: null,
    });
    // Edited where it stood: no successor row was opened for it.
    expect(row.change_reason).toBe(`Operator edit | ${telematicsPendingMarker(SEED_FLAGS)}`);
    const versions = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM fleet_operational_incident_rules WHERE incident_type = 'severe_driving'`,
    );
    expect(versions.rows[0]!.count).toBe(2);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('leaves an operator PENDING high row completely alone', async () => {
    // Not critical, so branch B's severity filter skips it — and it carries no
    // 529 marker, so the rollback will not touch it either.
    await pendingOperatorVersion('lost_contact_moving', 2, 'high', 'Operator lowered it first');
    await db.query(FORWARD);

    const row = await ruleRow('lost_contact_moving');
    expect(row).toMatchObject({ version: 2, severity: 'high', pending: true });
    expect(row.change_reason).toBe('Operator lowered it first');
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('is a no-op on a second run', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);
    const afterFirst = await ruleRow('severe_driving');

    await db.query(FORWARD);

    expect(await ruleRow('severe_driving')).toEqual(afterFirst);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('applies and re-versions the same way statement by statement', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await applyForwardSplit();

    expect(await ruleRow('severe_driving')).toMatchObject({
      version: 2, severity: 'high', whatsapp_enabled: false, pending: true, effective_to: null,
    });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('is restored by the rollback, marker stripped', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    const row = await ruleRow('severe_driving');
    expect(row).toMatchObject({
      version: 2, severity: 'critical', whatsapp_enabled: true,
      immediate_notification: true, include_in_morning_summary: false, pending: true,
    });
    expect(row.change_reason).toBe('Operator edit');
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('is restored the same way by a statement-by-statement rollback', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await applyForwardSplit();

    const client = await db.connect();
    try {
      for (const statement of rollbackStatements({ withTransaction: true })) await client.query(statement);
    } finally {
      client.release();
    }

    expect(await ruleRow('severe_driving')).toMatchObject({ version: 2, severity: 'critical', whatsapp_enabled: true });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('rollback is a no-op on a second run, and never touches the operator pending high row', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical');
    await pendingOperatorVersion('lost_contact_moving', 2, 'high', 'Operator lowered it first');
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const afterFirst = await ruleRow('severe_driving');

    await db.query(ROLLBACK);

    expect(await ruleRow('severe_driving')).toEqual(afterFirst);
    expect(await ruleRow('lost_contact_moving')).toMatchObject({ severity: 'high', change_reason: 'Operator lowered it first' });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });
});

describe('a pending row whose flags are NOT 510 seed shape', () => {
  // The seed-shaped fixture above cannot catch a rollback that restores
  // constants: every value it asserts happens to equal the constant. This one
  // holds a critical rule with WhatsApp deliberately OFF.
  const OPERATOR_FLAGS = {
    whatsappEnabled: false, immediateNotification: false, includeInMorningSummary: true,
  };

  async function applyForwardSplit(): Promise<void> {
    const client = await db.connect();
    try {
      for (const statement of forwardStatements()) await client.query(statement);
    } finally {
      client.release();
    }
  }

  async function rollbackSplit(): Promise<void> {
    const client = await db.connect();
    try {
      for (const statement of rollbackStatements({ withTransaction: true })) await client.query(statement);
    } finally {
      client.release();
    }
  }

  it('records the prior flags in the marker', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical', 'WhatsApp deliberately off', OPERATOR_FLAGS);
    await db.query(FORWARD);

    const row = await ruleRow('severe_driving');
    expect(row).toMatchObject({ severity: 'high', whatsapp_enabled: false, include_in_morning_summary: true });
    expect(row.change_reason).toBe(`WhatsApp deliberately off | ${telematicsPendingMarker(OPERATOR_FLAGS)}`);
  });

  it('restores exactly those flags, not the seed shape', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical', 'WhatsApp deliberately off', OPERATOR_FLAGS);
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    const row = await ruleRow('severe_driving');
    // Restoring 510's seed shape here would turn this operator's WhatsApp back
    // on — a widening the rollback has no business performing.
    expect(row).toMatchObject({
      severity: 'critical',
      whatsapp_enabled: false,
      immediate_notification: false,
      include_in_morning_summary: true,
    });
    expect(row.change_reason).toBe('WhatsApp deliberately off');
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('does the same under split execution, both ways', async () => {
    await pendingOperatorVersion('severe_driving', 2, 'critical', 'WhatsApp deliberately off', OPERATOR_FLAGS);
    await applyForwardSplit();
    expect(await ruleRow('severe_driving')).toMatchObject({ severity: 'high', whatsapp_enabled: false });

    await rollbackSplit();

    expect(await ruleRow('severe_driving')).toMatchObject({
      severity: 'critical', whatsapp_enabled: false,
      immediate_notification: false, include_in_morning_summary: true,
    });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('survives a marker with no preceding reason', async () => {
    await pendingOperatorVersion('lost_contact_moving', 2, 'critical', null, OPERATOR_FLAGS);
    await db.query(FORWARD);
    expect((await ruleRow('lost_contact_moving')).change_reason).toBe(telematicsPendingMarker(OPERATOR_FLAGS));

    await db.query(ROLLBACK);

    const row = await ruleRow('lost_contact_moving');
    expect(row.change_reason).toBeNull();
    expect(row).toMatchObject({ severity: 'critical', whatsapp_enabled: false });
  });
});

describe('a row that activates BETWEEN the two branches under split execution', () => {
  it('is still caught, because branch B reads no clock of its own', async () => {
    // Branch A runs, sees effective_from in the future, and skips the row.
    // By the time branch B runs the row has become active. A mirror-image
    // `effective_from >= now()` on B would skip it too, and it would stay
    // critical with WhatsApp armed — silently, at rc=0.
    await pendingOperatorVersion('severe_driving', 2, 'critical', 'Operator edit', SEED_FLAGS, '400 milliseconds');

    const client = await db.connect();
    try {
      for (const statement of forwardStatements()) {
        await client.query(statement);
        // Let the row cross from pending to active between the two branches.
        if (statement.includes('529:pending{wa=')) continue;
        if (statement.includes('WITH closed AS (')) await client.query("SELECT pg_sleep(1)");
      }
    } finally {
      client.release();
    }

    expect(await ruleRow('severe_driving')).toMatchObject({
      version: 2, severity: 'high', whatsapp_enabled: false,
    });
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });
});

describe('the version the active branch assigns', () => {
  it('is that type own max + 1, not the fleet-wide max', async () => {
    // One type far ahead of the others. A global max(version) would push all
    // four to v8 and break the per-type (incident_type, version) sequence.
    await operatorVersion('severe_driving', 7, 'critical');
    await db.query(FORWARD);

    const open = await openIncidentRules();
    expect(open.find((row) => row.incident_type === 'severe_driving')).toMatchObject({ version: 8 });
    for (const type of ['prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry']) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({ version: 2, severity: 'high' });
    }
  });
});

describe('applied one statement at a time, the way psql -f sends them', () => {
  // The deploy path is scripts/run-pending-migrations.sh:127, which uses
  // `psql -1` and so supplies a transaction. A hand-run `psql -f` does not, and
  // the plan's own rollback instructions show exactly that invocation. Nothing
  // in this file may depend on an ambient transaction.

  async function applyForwardSplit(): Promise<void> {
    const client = await db.connect();
    try {
      for (const statement of forwardStatements()) await client.query(statement);
    } finally {
      client.release();
    }
  }

  it('leaves exactly 14 open rules with the four at high', async () => {
    await applyForwardSplit();

    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({
        version: 2, severity: 'high', whatsapp_enabled: false,
      });
    }
  });

  it('leaves each closed row exactly adjacent to its replacement', async () => {
    // This is the property the rollback identifies its target by. Two separate
    // statements observing `now()` independently differ by milliseconds, and
    // the rollback would then match nothing, delete 529's rows, reopen none,
    // and exit 0 — four incident types stranded with no effective rule.
    await applyForwardSplit();

    const rows = await db.query<{ incident_type: string; adjacent: boolean }>(
      `SELECT authored.incident_type,
              EXISTS (
                SELECT 1 FROM fleet_operational_incident_rules closed
                 WHERE closed.incident_type = authored.incident_type
                   AND closed.effective_to = authored.effective_from
              ) AS adjacent
         FROM fleet_operational_incident_rules authored
        WHERE authored.change_reason = $1 AND authored.effective_to IS NULL
        ORDER BY authored.incident_type`,
      [TELEMATICS_REVERSION_CHANGE_REASON],
    );

    expect(rows.rows).toHaveLength(REVERSIONED_TELEMATICS_INCIDENT_TYPES.length);
    for (const row of rows.rows) expect(row.adjacent, row.incident_type).toBe(true);
  });

  it('and a statement-by-statement rollback puts all 14 back', async () => {
    await applyForwardSplit();

    const client = await db.connect();
    try {
      for (const statement of rollbackStatements({ withTransaction: true })) await client.query(statement);
    } finally {
      client.release();
    }

    const open = await openIncidentRules();
    expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(open.find((row) => row.incident_type === type), type).toMatchObject({
        version: 1, severity: 'critical', whatsapp_enabled: true,
      });
    }
    expect(await authoredCount()).toBe(0);
  });

  it('is still a no-op on a second split run', async () => {
    await applyForwardSplit();
    const afterFirst = await openIncidentRules();

    await applyForwardSplit();

    expect(await openIncidentRules()).toEqual(afterFirst);
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

  it('keeps an operator version it did not write, and keeps its own superseded row', async () => {
    await db.query(FORWARD);
    // The operator supersedes 529's row with a `high` version of their own —
    // same severity, different author. Only the change_reason tells them apart.
    await operatorVersion('severe_driving', 3, 'high');

    await db.query(ROLLBACK);

    expect(await openRuleFor('severe_driving')).toMatchObject({ version: 3, severity: 'high' });
    // 529's row is closed now and stays closed: incidents opened while it was in
    // force carry its id in incident_rule_id, and that FK is ON DELETE SET NULL,
    // so deleting the row would make those incidents forget which rule judged
    // them.
    expect(await authoredCount('severe_driving')).toBe(1);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('leaves a hand-closed 529 row alone instead of failing the whole file', async () => {
    await db.query(FORWARD);
    // Someone closed 529's rule without opening a replacement. The type is
    // ALREADY broken (no open rule) and that is not the rollback's to repair.
    // What matters is that it does not make things worse: reopening "the newest
    // closed critical row" here would extend version 1 to 'infinity' straight
    // through the closed 529 row, raise 23P01, and abort the whole transaction —
    // taking the other three types' restoration down with it.
    await db.query(
      `UPDATE fleet_operational_incident_rules SET effective_to = now()
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
    );

    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();

    expect(await openRuleFor('severe_driving')).toBeUndefined();
    expect(await authoredCount('severe_driving')).toBe(1);
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES.filter((each) => each !== 'severe_driving')) {
      expect(await openRuleFor(type), type).toMatchObject({ version: 1, severity: 'critical' });
    }
  });

  it('is atomic — an induced failure after the delete takes the delete back', async () => {
    await db.query(FORWARD);
    expect(await authoredCount()).toBe(4);

    const client = await db.connect();
    try {
      // No UPDATE privilege, so statement 3 (the reopen) fails after statement 2
      // (the delete) has already run. Statements are sent ONE AT A TIME, as
      // psql sends them — the file's own BEGIN is the only thing holding them
      // together.
      await client.query(`SET ROLE ${DELETE_ONLY_ROLE}`);
      await expect(runStatements(client, rollbackStatements({ withTransaction: true })))
        .rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET ROLE');
    } finally {
      client.release();
    }

    expect(await authoredCount()).toBe(4);
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
  });

  it('without its transaction, that same failure strands four incident types', async () => {
    // The counterfactual the BEGIN exists for. Four types end with NO open rule,
    // and `loadEffectiveIncidentRule` throws for every incident of them.
    await db.query(FORWARD);

    const client = await db.connect();
    try {
      await client.query(`SET ROLE ${DELETE_ONLY_ROLE}`);
      await expect(runStatements(client, rollbackStatements({ withTransaction: false })))
        .rejects.toMatchObject({ code: '42501' });
      await client.query('RESET ROLE');
    } finally {
      client.release();
    }

    expect(await authoredCount()).toBe(0);
    expect(await openIncidentRules())
      .toHaveLength(SEEDED_OPEN_RULE_COUNT - REVERSIONED_TELEMATICS_INCIDENT_TYPES.length);
  });

  it('removes both permission keys', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const permissions = await db.query(
      `SELECT key FROM access_permissions WHERE key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats')`,
    );
    expect(permissions.rows).toHaveLength(0);
    const roles = await db.query(
      `SELECT role FROM role_permissions WHERE permission_key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats')`,
    );
    expect(roles.rows).toHaveLength(0);
  });
});

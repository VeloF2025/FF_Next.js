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
  telematicsReversionMarker,
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
  // Incidents first: the guard tests seed them, and a leaked incident makes
  // every later test fail on the guard rather than on what it is testing.
  await db.query('DELETE FROM fleet_operational_incidents');
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

function rollbackStatements({ withTransaction }: { withTransaction: boolean }): string[] {
  const statements = splitStatements(ROLLBACK);
  return withTransaction ? statements : statements.filter((s) => !/^(BEGIN|COMMIT)$/i.test(s));
}

async function runStatements(client: { query: (text: string) => Promise<unknown> }, statements: string[]): Promise<void> {
  for (const statement of statements) await client.query(statement);
}

/** How many rows carry 529's marker. */
async function markedCount(): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM fleet_operational_incident_rules
      WHERE change_reason LIKE '%529:reversioned{%'`,
  );
  return rows.rows[0]!.count;
}

/**
 * The rule `loadEffectiveIncidentRule` would resolve for a type right now.
 *
 * This — not "the open row" — is what the incident producer actually reads.
 * settingsRepository.ts selects on
 * `effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)`,
 * so a CLOSED row can still be the effective one if its window has not expired,
 * and an OPEN row can be effective for nobody if it activates tomorrow.
 */
async function effectiveRuleFor(type: string) {
  const { rows } = await db.query(
    `SELECT version, severity, whatsapp_enabled, immediate_notification, include_in_morning_summary
       FROM fleet_operational_incident_rules
      WHERE incident_type = $1
        AND effective_from <= now()
        AND (effective_to IS NULL OR effective_to > now())
      ORDER BY version DESC LIMIT 1`,
    [type],
  );
  return rows[0];
}

/**
 * A predecessor that is CLOSED but still EFFECTIVE — the state
 * `versionIncidentRule` leaves behind whenever it versions a rule with a future
 * activation. The closed row governs until the successor activates.
 */
async function closedButStillEffectivePredecessor(type: string, version: number, severity: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE fleet_operational_incident_rules SET effective_to = now() + interval '2 hours'
        WHERE incident_type = $1 AND effective_to IS NULL`,
      [type],
    );
    await client.query(
      `INSERT INTO fleet_operational_incident_rules
         (incident_type, version, effective_from, creates_incident, severity, immediate_notification,
          in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
          acknowledgement_target_minutes, change_reason)
       VALUES ($1, $2, now() + interval '2 hours', true, $3, true, true, true, true, false, 5, 'Operator scheduled')`,
      [type, version, severity],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/** One open incident of `type`, which the guard must refuse to run past. */
async function seedIncident(type: string): Promise<void> {
  await db.query(
    `INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, lifecycle_status, detected_at)
     VALUES ($1, $2, 'critical', 'open', now())`,
    [`INC-529-${type}`, type],
  );
}


describe('before the migration runs', () => {
  it('leaves all six telematics rules critical with WhatsApp armed', async () => {
    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(await effectiveRuleFor(type), type).toMatchObject({
        version: 1, severity: 'critical', whatsapp_enabled: true,
      });
    }
    expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
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

describe('what else the forward migration ships', () => {
  beforeEach(async () => { await db.query(FORWARD); });

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
      version: 1, timezone: 'Africa/Johannesburg', start_time: '21:00:00', end_time: '05:00:00',
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
      expect(row.actions).toMatchObject({ view: true, create: false, edit: false, delete: false });
    }
  });

  it('keeps fleet.vehicle-rules to admins, because it arms and disarms detectors', async () => {
    const roles = await db.query(
      `SELECT role, actions FROM role_permissions WHERE permission_key = 'fleet.vehicle-rules' ORDER BY role`,
    );
    expect(roles.rows.map((row) => row.role)).toEqual(['admin', 'super_admin']);
    for (const row of roles.rows) {
      expect(row.actions).toMatchObject({ view: true, create: true, edit: true, delete: false });
    }
  });

  it('is repeatable', async () => {
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    const { rows } = await db.query('SELECT count(*)::int AS count FROM fleet_vehicle_operational_rules');
    expect(rows[0].count).toBe(1);
  });
});

/**
 * The seven states "which row is the current rule" can be in.
 *
 * Five earlier shapes of this migration closed the open row and inserted a
 * successor, and each was defeated by a state the previous one had not
 * enumerated. The redesign has no state machine — it matches on incident_type
 * and severity — so this table exists to prove that claim rather than to guide
 * a branch.
 *
 * Every state is asserted through `effectiveRuleFor`, the predicate
 * `loadEffectiveIncidentRule` actually uses, NOT through "the open row". Those
 * differ, and the difference is the state that survived five rounds.
 */
const STATES: Array<{ name: string; setUp: () => Promise<void> }> = [
  { name: 'the 510 seed, untouched', setUp: async () => {} },
  {
    name: 'an operator active version 2, still critical',
    setUp: () => operatorVersion('severe_driving', 2, 'critical'),
  },
  {
    name: 'an operator active version 2, deliberately not critical',
    setUp: () => operatorVersion('severe_driving', 2, 'normal'),
  },
  {
    name: 'a closed version 2 sitting in the history',
    setUp: () => closedHistoricVersion('severe_driving', 2),
  },
  {
    name: 'a PENDING open version 2, still critical',
    setUp: () => pendingOperatorVersion('severe_driving', 2, 'critical'),
  },
  {
    name: 'a PENDING open version 2 the operator already lowered',
    setUp: () => pendingOperatorVersion('severe_driving', 2, 'high', 'Operator lowered it first'),
  },
  {
    name: 'a CLOSED but still EFFECTIVE predecessor with a future successor',
    setUp: () => closedButStillEffectivePredecessor('severe_driving', 2, 'critical'),
  },
];

const MODES: Array<{ name: string; apply: (sql: string) => Promise<void> }> = [
  {
    name: 'runner (one query, psql -1)',
    apply: async (sql) => { await db.query(sql); },
  },
  {
    name: 'psql -f (statement by statement)',
    apply: async (sql) => {
      const client = await db.connect();
      try {
        for (const statement of splitStatements(sql)) await client.query(statement);
      } finally {
        client.release();
      }
    },
  },
];

describe.each(MODES)('applied via $name', ({ apply }) => {
  describe.each(STATES)('with $name', ({ name, setUp }) => {
    // The two states an operator deliberately took OFF critical must be left
    // exactly as they set them; every other state must end up high.
    const operatorOwnsIt = name.includes('deliberately not critical') || name.includes('already lowered');

    it('leaves every one of the four types EFFECTIVELY high', async () => {
      await setUp();
      await apply(FORWARD);

      for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
        const effective = await effectiveRuleFor(type);
        expect(effective, `${type}: no effective rule at all`).toBeDefined();
        if (type === 'severe_driving' && operatorOwnsIt) continue;
        expect(effective, type).toMatchObject({
          severity: 'high', whatsapp_enabled: false,
          immediate_notification: false, include_in_morning_summary: true,
        });
      }
    });

    it('leaves the two emergency types critical and on WhatsApp', async () => {
      await setUp();
      await apply(FORWARD);

      for (const type of ['accident_sos', 'theft_after_hours_movement']) {
        expect(await effectiveRuleFor(type), type).toMatchObject({
          severity: 'critical', whatsapp_enabled: true,
        });
      }
    });

    it('leaves exactly 14 open rules and never a type without one', async () => {
      await setUp();
      await apply(FORWARD);

      const open = await openIncidentRules();
      expect(open).toHaveLength(SEEDED_OPEN_RULE_COUNT);
      const counts = await db.query<{ incident_type: string; count: number }>(
        `SELECT incident_type, count(*)::int AS count FROM fleet_operational_incident_rules
          WHERE effective_to IS NULL GROUP BY incident_type`,
      );
      for (const row of counts.rows) expect(row.count, row.incident_type).toBe(1);
    });

    it('is a no-op on a second run', async () => {
      await setUp();
      await apply(FORWARD);
      const first = await db.query(
        `SELECT id, version, severity, whatsapp_enabled, change_reason FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
      );

      await apply(FORWARD);

      const second = await db.query(
        `SELECT id, version, severity, whatsapp_enabled, change_reason FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
      );
      expect(second.rows).toEqual(first.rows);
    });

    it('is put back critical by the rollback', async () => {
      await setUp();
      await apply(FORWARD);
      await apply(ROLLBACK);

      for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
        const effective = await effectiveRuleFor(type);
        expect(effective, `${type}: no effective rule after rollback`).toBeDefined();
        if (type === 'severe_driving' && operatorOwnsIt) continue;
        expect(effective, type).toMatchObject({ severity: 'critical', whatsapp_enabled: true });
      }
      expect(await markedCount()).toBe(0);
      expect(await openIncidentRules()).toHaveLength(SEEDED_OPEN_RULE_COUNT);
    });

    it('leaves an operator deliberate non-critical row exactly as they set it', async () => {
      if (!operatorOwnsIt) return;
      await setUp();
      const before = await ruleRow('severe_driving');

      await apply(FORWARD);

      expect(await ruleRow('severe_driving')).toEqual(before);
    });
  });
});

/** Has 529's own DDL landed? Used to prove a fired guard applied nothing at all. */
async function migrationArtefacts() {
  const table = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'fleet_vehicle_operational_rules'`,
    [SCHEMA],
  );
  const column = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'fleet_vehicles' AND column_name = 'after_hours_exempt'`,
    [SCHEMA],
  );
  const permissions = await db.query(
    `SELECT key FROM access_permissions WHERE key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats')`,
  );
  return { tables: table.rows.length, columns: column.rows.length, permissions: permissions.rows.length };
}

describe.each(MODES)('the guard, applied via $name', ({ apply }) => {
  it('refuses to run when an incident of a telematics type exists', async () => {
    await seedIncident('severe_driving');
    await expect(apply(FORWARD)).rejects.toMatchObject({ code: 'P0001' });
  });

  it('applies NOTHING when it fires — no rules, no table, no column, no permissions', async () => {
    // The guard is the FIRST statement in the file, above every CREATE. Under
    // the runner the transaction rolls back; under statement-at-a-time
    // application that stops on error, execution never reaches the DDL.
    await seedIncident('lost_contact_moving');
    await apply(FORWARD).catch(() => undefined);

    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(await effectiveRuleFor(type), type).toMatchObject({ severity: 'critical', whatsapp_enabled: true });
    }
    expect(await markedCount()).toBe(0);
    expect(await migrationArtefacts()).toEqual({ tables: 0, columns: 0, permissions: 0 });
  });

  it('lets an incident of an UNRELATED type through', async () => {
    await seedIncident('late');
    await expect(apply(FORWARD)).resolves.toBeUndefined();
    expect(await effectiveRuleFor('severe_driving')).toMatchObject({ severity: 'high' });
  });
});

describe('the guard under a psql that does not stop on error', () => {
  it('still leaves every rule untouched, because the guard and the UPDATE are one block', async () => {
    // A bare `psql -f` carries on past an error. run-pending-migrations.sh:127
    // passes ON_ERROR_STOP=1 so this is not the deploy path, but the rules must
    // survive it regardless: as two statements the guard would raise and the
    // UPDATE would run anyway.
    await seedIncident('dangerous_area_entry');

    const client = await db.connect();
    try {
      for (const statement of splitStatements(FORWARD)) {
        await client.query(statement).catch(() => undefined);
      }
    } finally {
      client.release();
    }

    for (const type of REVERSIONED_TELEMATICS_INCIDENT_TYPES) {
      expect(await effectiveRuleFor(type), type).toMatchObject({ severity: 'critical' });
    }
    expect(await markedCount()).toBe(0);
  });
});

describe('the marker', () => {
  const OPERATOR_FLAGS = {
    whatsappEnabled: false, immediateNotification: true, includeInMorningSummary: true,
  };

  it('records the prior flags, which are not the seed shape and differ from each other', async () => {
    // wa !== imm deliberately: a fixture where every flag agrees cannot tell a
    // per-flag restore from a blanket one.
    await db.query(
      `UPDATE fleet_operational_incident_rules
          SET whatsapp_enabled = $1, immediate_notification = $2, include_in_morning_summary = $3,
              change_reason = 'WhatsApp deliberately off'
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
      [OPERATOR_FLAGS.whatsappEnabled, OPERATOR_FLAGS.immediateNotification, OPERATOR_FLAGS.includeInMorningSummary],
    );

    await db.query(FORWARD);

    const row = await ruleRow('severe_driving');
    expect(row.change_reason).toBe(`WhatsApp deliberately off | ${telematicsReversionMarker(OPERATOR_FLAGS)}`);
    expect(row).toMatchObject({ severity: 'high', whatsapp_enabled: false, immediate_notification: false });
  });

  it('restores exactly those flags, not the seed shape', async () => {
    await db.query(
      `UPDATE fleet_operational_incident_rules
          SET whatsapp_enabled = $1, immediate_notification = $2, include_in_morning_summary = $3,
              change_reason = 'WhatsApp deliberately off'
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
      [OPERATOR_FLAGS.whatsappEnabled, OPERATOR_FLAGS.immediateNotification, OPERATOR_FLAGS.includeInMorningSummary],
    );
    await db.query(FORWARD);
    await db.query(ROLLBACK);

    // Restoring 510's seed shape here would turn this operator's WhatsApp back
    // on and their morning summary off — a widening the rollback has no
    // business performing.
    expect(await ruleRow('severe_driving')).toMatchObject({
      severity: 'critical',
      whatsapp_enabled: false,
      immediate_notification: true,
      include_in_morning_summary: true,
      change_reason: 'WhatsApp deliberately off',
    });
  });

  it('round-trips a row that had no change_reason at all back to NULL', async () => {
    await db.query(
      `UPDATE fleet_operational_incident_rules SET change_reason = NULL
        WHERE incident_type = 'lost_contact_moving' AND effective_to IS NULL`,
    );
    await db.query(FORWARD);
    expect((await ruleRow('lost_contact_moving')).change_reason).toBe(telematicsReversionMarker({
      whatsappEnabled: true, immediateNotification: true, includeInMorningSummary: false,
    }));

    await db.query(ROLLBACK);

    expect((await ruleRow('lost_contact_moving')).change_reason).toBeNull();
  });

  it('the FORWARD strip is anchored too — prose quoting the marker survives 529', async () => {
    // The strip that stops a re-run doubling the marker is `$`-anchored for the
    // same reason the rollback's match is. Unanchored, regexp_replace takes the
    // FIRST match, so an operator who quoted the marker mid-sentence would have
    // it cut out of their prose and the sentence silently mangled.
    const quoted = `Saw ${telematicsReversionMarker({
      whatsappEnabled: true, immediateNotification: true, includeInMorningSummary: false,
    })} in the log, investigating`;
    await db.query(
      `UPDATE fleet_operational_incident_rules SET change_reason = $1
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
      [quoted],
    );

    await db.query(FORWARD);

    const row = await ruleRow('severe_driving');
    // The prose is untouched; exactly one marker was APPENDED to it.
    expect(row.change_reason).toBe(`${quoted} | ${telematicsReversionMarker({
      whatsappEnabled: true, immediateNotification: true, includeInMorningSummary: false,
    })}`);
    expect((row.change_reason as string).startsWith(quoted)).toBe(true);
  });

  it('is anchored to the END — prose containing it mid-string is not restored', async () => {
    // The rollback matches with `$`. An operator quoting the marker in the
    // middle of their own note must not have their row rewritten.
    const prose = `Saw ${telematicsReversionMarker({ whatsappEnabled: true, immediateNotification: true, includeInMorningSummary: false })} in the log, investigating`;
    await db.query(
      `UPDATE fleet_operational_incident_rules SET severity = 'high', change_reason = $1
        WHERE incident_type = 'prolonged_unauthorized_stop' AND effective_to IS NULL`,
      [prose],
    );

    await db.query(ROLLBACK);

    const row = await ruleRow('prolonged_unauthorized_stop');
    expect(row.severity).toBe('high');
    expect(row.change_reason).toBe(prose);
  });
});

describe('a row put back to critical by hand, then re-migrated', () => {
  /** What an operator does when they disagree: flip severity back, leave the prose alone. */
  async function manualReCritical(type: string): Promise<void> {
    await db.query(
      `UPDATE fleet_operational_incident_rules SET severity = 'critical'
        WHERE incident_type = $1 AND effective_to IS NULL`,
      [type],
    );
  }

  it('carries ONE marker, not two, and it holds the latest prior flags', async () => {
    await db.query(
      `UPDATE fleet_operational_incident_rules SET change_reason = 'Seeded by 510'
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
    );
    await db.query(FORWARD);
    await manualReCritical('severe_driving');

    await db.query(FORWARD);

    const row = await ruleRow('severe_driving');
    // The second pass reads the flags the row held on the way IN — which the
    // first pass had already set to false/false/true.
    expect(row.change_reason).toBe(`Seeded by 510 | ${telematicsReversionMarker({
      whatsappEnabled: false, immediateNotification: false, includeInMorningSummary: true,
    })}`);
    expect((row.change_reason as string).match(/529:reversioned\{/g)).toHaveLength(1);
  });

  it('still restores cleanly, leaving no marker litter in the prose', async () => {
    await db.query(
      `UPDATE fleet_operational_incident_rules SET change_reason = 'Seeded by 510'
        WHERE incident_type = 'severe_driving' AND effective_to IS NULL`,
    );
    await db.query(FORWARD);
    await manualReCritical('severe_driving');
    await db.query(FORWARD);

    await db.query(ROLLBACK);

    expect((await ruleRow('severe_driving')).change_reason).toBe('Seeded by 510');
    expect(await markedCount()).toBe(0);
  });

  it('is never restored over by the rollback while the operator holds it critical', async () => {
    // The rollback matches `severity = 'high'`. A row the operator has taken
    // back to critical is theirs, marker or no marker: rewriting its flags from
    // a stale marker would undo their decision.
    await db.query(FORWARD);
    await manualReCritical('severe_driving');
    const before = await ruleRow('severe_driving');

    await db.query(ROLLBACK);

    expect(await ruleRow('severe_driving')).toEqual(before);
  });

  it('rollback run twice is a no-op the second time', async () => {
    await db.query(FORWARD);
    await manualReCritical('severe_driving');
    await db.query(ROLLBACK);
    const first = await db.query(
      `SELECT id, severity, whatsapp_enabled, immediate_notification, include_in_morning_summary, change_reason
         FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
    );

    await db.query(ROLLBACK);

    const second = await db.query(
      `SELECT id, severity, whatsapp_enabled, immediate_notification, include_in_morning_summary, change_reason
         FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
    );
    expect(second.rows).toEqual(first.rows);
  });
});

describe('the rollback', () => {
  it('removes the table, the column and both permission keys', async () => {
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
    const permissions = await db.query(
      `SELECT key FROM access_permissions WHERE key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats')`,
    );
    expect(permissions.rows).toHaveLength(0);
  });

  it('is idempotent', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    const first = await db.query(
      `SELECT id, severity, whatsapp_enabled, change_reason FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
    );

    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();

    const second = await db.query(
      `SELECT id, severity, whatsapp_enabled, change_reason FROM fleet_operational_incident_rules ORDER BY incident_type, version`,
    );
    expect(second.rows).toEqual(first.rows);
  });

  it('leaves the migration re-appliable', async () => {
    await db.query(FORWARD);
    await db.query(ROLLBACK);
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
    expect(await effectiveRuleFor('severe_driving')).toMatchObject({ severity: 'high' });
  });

  it('is atomic — an induced failure restores nothing and drops nothing', async () => {
    // Statements sent ONE AT A TIME, as psql -f sends them: the file's own BEGIN
    // is the only thing holding them together. Without UPDATE privilege the
    // restore fails, and the table must survive with it.
    await db.query(FORWARD);

    const client = await db.connect();
    try {
      await client.query(`SET ROLE ${DELETE_ONLY_ROLE}`);
      await expect(runStatements(client, rollbackStatements({ withTransaction: true })))
        .rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET ROLE');
    } finally {
      client.release();
    }

    expect(await markedCount()).toBe(4);
    const table = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'fleet_vehicle_operational_rules'`,
      [SCHEMA],
    );
    expect(table.rows).toHaveLength(1);
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


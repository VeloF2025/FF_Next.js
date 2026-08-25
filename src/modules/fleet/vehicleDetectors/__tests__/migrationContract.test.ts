/**
 * What migration 529's SQL says, asserted without a database.
 *
 * The real-Postgres test beside this one (tests/migrations/529_*.test.ts)
 * asserts what the database DOES. This file asserts the things a running
 * database can no longer tell you apart — chiefly that the set of incident
 * types re-versioned to `high` is exactly the four the TS constant names, and
 * not a fifth that would silently disarm `accident_sos`'s WhatsApp path.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REVERSIONED_TELEMATICS_INCIDENT_TYPES,
  TELEMATICS_REVERSION_MARKER_PATTERN,
  TELEMATICS_REVERSION_MARKER_PREFIX,
  VEHICLE_RULE_TIMEZONE,
} from '../types';

const SQL_DIR = resolve(process.cwd(), 'scripts/migrations/sql');
const forward = readFileSync(resolve(SQL_DIR, '529_fleet_vehicle_operational_rules.sql'), 'utf8');
const rollback = readFileSync(resolve(SQL_DIR, 'rollback_529_fleet_vehicle_operational_rules.sql'), 'utf8');

/**
 * Every `incident_type = ANY(ARRAY[...])` list in a migration file.
 *
 * All of them, not the first: the rollback carries two (the delete and the
 * restore), and a fifth type slipped into just one of them would leave a type
 * deleted and never reopened.
 */
function reversionedTypeLists(sql: string): string[][] {
  const blocks = [...sql.matchAll(/incident_type = ANY\(ARRAY\[([\s\S]*?)\]::text\[\]\)/g)];
  if (blocks.length === 0) throw new Error('529 no longer names an explicit incident-type list');
  return blocks.map((block) => [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!));
}

const expectedTypes = [...REVERSIONED_TELEMATICS_INCIDENT_TYPES].sort();

/** The whole re-versioning: one guarded DO block. */
function reversionBlock(): string {
  const from = forward.indexOf('DO $$\nBEGIN\n  IF EXISTS (');
  if (from < 0) throw new Error('529 no longer re-versions inside a guarded DO block');
  return forward.slice(from, forward.indexOf('END $$;', from));
}

/** Just the UPDATE inside that block — no guard prose, so word matches are meaningful. */
function reversionUpdate(): string {
  const block = reversionBlock();
  return block.slice(block.indexOf('UPDATE fleet_operational_incident_rules'));
}

describe('the re-versioned incident types', () => {
  it('are exactly the four the TS constant names, in every list', () => {
    for (const list of reversionedTypeLists(forward)) expect(list.sort()).toEqual(expectedTypes);
  });

  it('never include the two emergency types that must keep WhatsApp', () => {
    for (const list of reversionedTypeLists(forward)) {
      expect(list).not.toContain('accident_sos');
      expect(list).not.toContain('theft_after_hours_movement');
    }
  });

  it('are re-versioned by ONE statement with no state machine at all', () => {
    // Five earlier shapes closed the open row and inserted a successor, and each
    // was defeated by a state the previous one had not enumerated. This one
    // matches on incident_type and severity and nothing else.
    const block = reversionBlock();
    expect(block).toContain('UPDATE fleet_operational_incident_rules');
    expect(block).not.toMatch(/INSERT INTO fleet_operational_incident_rules/i);
    const update = reversionUpdate();
    // No dates, no version arithmetic, no clock: nothing that can disagree with
    // a row's state.
    expect(update).not.toMatch(/effective_to\s*=/);
    expect(update).not.toMatch(/effective_from/);
    expect(update).not.toMatch(/max\(/);
    expect(update).not.toMatch(/\bversion\b/);
    expect(update).not.toMatch(/\bnow\(\)\s*(<|>|<=|>=)/);
    expect(forward).not.toContain('CREATE TEMP TABLE');
    expect(forward).not.toContain('WITH closed AS (');
  });

  it('refuses to run at all if any incident of those types exists', () => {
    // In-place editing is only safe while no incident references these rules.
    // The guard proves that at apply time instead of asserting it.
    const block = reversionBlock();
    expect(block).toContain('SELECT 1 FROM fleet_operational_incidents');
    expect(block).toMatch(/RAISE EXCEPTION '529:/);
    // Guard BEFORE update, and inside the same block.
    expect(block.indexOf('RAISE EXCEPTION')).toBeLessThan(block.indexOf('UPDATE fleet_operational_incident_rules'));
  });

  it('keeps the guard and the update inseparable, in every execution mode', () => {
    // As two statements the guard would only stop the update under
    // ON_ERROR_STOP. run-pending-migrations.sh:127 passes it; a hand-run
    // `psql -f` does not. One DO block cannot be half-executed.
    expect(reversionBlock()).toMatch(/DO \$\$[\s\S]*RAISE EXCEPTION[\s\S]*UPDATE fleet_operational_incident_rules/);
  });

  it('runs before any DDL in the file, so a fired guard leaves nothing behind', () => {
    // At the foot of the file the table, the column and the permission rows
    // would already be applied by the time the guard fired.
    const guardAt = forward.indexOf('DO $$\nBEGIN\n  IF EXISTS (');
    expect(guardAt).toBeGreaterThan(-1);
    for (const ddl of [
      'CREATE EXTENSION IF NOT EXISTS btree_gist',
      'CREATE TABLE IF NOT EXISTS fleet_vehicle_operational_rules',
      'ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS after_hours_exempt',
      'INSERT INTO access_permissions',
    ]) {
      expect(forward.indexOf(ddl), ddl).toBeGreaterThan(guardAt);
    }
  });

  it('strips any existing marker before appending a fresh one', () => {
    // An operator who flips a row back to critical by hand and re-runs the
    // migration must not accumulate two markers: the rollback matches the LAST
    // one and the first would be left as litter in the prose.
    const update = reversionUpdate();
    const clause = update.slice(update.indexOf('change_reason = CASE'), update.indexOf('updated_at = now()'));
    expect(clause.match(/regexp_replace\(/g) ?? []).toHaveLength(2);
    expect(clause).toContain("529:reversioned\\{[^}]*\\}$");
  });

  it('sets high with WhatsApp off and the morning summary on', () => {
    // `requiresMandatoryIncidentWhatsApp` is severity === 'critical' &&
    // producerKind === 'source_event'. 'high' is the whole mechanism.
    const block = reversionBlock();
    expect(block).toContain("severity = 'high'");
    expect(block).toContain('whatsapp_enabled = false');
    expect(block).toContain('immediate_notification = false');
    expect(block).toContain('include_in_morning_summary = true');
  });

  it('is idempotent by the severity filter, and by nothing else', () => {
    const block = reversionBlock();
    expect(block).toContain("WHERE severity = 'critical'");
  });

  it('carries the prior flag values in the marker, not just a note', () => {
    // The severity filter constrains severity and NOTHING else. An operator may
    // hold a critical row with whatsapp_enabled false; restoring 510's seed
    // shape on rollback would silently re-arm their WhatsApp.
    const block = reversionBlock();
    expect(block).toContain(TELEMATICS_REVERSION_MARKER_PREFIX);
    expect(block).toContain("'529:reversioned{wa=' || whatsapp_enabled");
    expect(block).toContain("',imm=' || immediate_notification");
    expect(block).toContain("',morn=' || include_in_morning_summary");
  });

  it('carry no explicit BEGIN — psql -1 already wraps the file AND its record', () => {
    // Measured on PostgreSQL 15: with an inner BEGIN/COMMIT, a failure in the
    // trailing `-c "INSERT INTO schema_migrations ..."` leaves the migration
    // APPLIED and UNRECORDED, and an unrecorded migration re-runs next deploy.
    expect(forward).not.toMatch(/^\s*BEGIN\s*;/mi);
    expect(forward).not.toMatch(/^\s*COMMIT\s*;/mi);
    expect(forward).toContain('run-pending-migrations.sh:127');
  });
});

describe('the versioned rule table', () => {
  it('copies 498 versioning: unique version, no overlap, exactly one open row', () => {
    expect(forward).toMatch(/version INTEGER NOT NULL UNIQUE/);
    expect(forward).toMatch(/EXCLUDE USING gist \([\s\S]*tstzrange\(effective_from, COALESCE\(effective_to, 'infinity'::timestamptz\), '\[\)'\) WITH &&/);
    expect(forward).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_vehicle_operational_rules_one_open[\s\S]*WHERE effective_to IS NULL/);
  });

  it.each([
    ['harsh_linear_g', 'NUMERIC(5,3) NOT NULL DEFAULT 0.350'],
    ['harsh_lateral_g', 'NUMERIC(5,3) NOT NULL DEFAULT 0.350'],
    ['harsh_min_speed_kph', 'NUMERIC(6,2) NOT NULL DEFAULT 20'],
    ['speed_over_limit_kph', 'NUMERIC(6,2) NOT NULL DEFAULT 15'],
    ['theft_displacement_meters', 'INTEGER NOT NULL DEFAULT 500'],
    ['theft_min_positions', 'INTEGER NOT NULL DEFAULT 2'],
    ['unauthorized_stop_minutes', 'INTEGER NOT NULL DEFAULT 45'],
    ['lost_contact_minutes', 'INTEGER NOT NULL DEFAULT 30'],
    ['idle_alert_minutes', 'INTEGER NOT NULL DEFAULT 20'],
    ['known_site_radius_meters', 'INTEGER NOT NULL DEFAULT 500'],
    ['after_hours_start_time', "TIME NOT NULL DEFAULT '18:00'"],
    ['after_hours_end_time', "TIME NOT NULL DEFAULT '06:00'"],
    ['weekends_are_after_hours', 'BOOLEAN NOT NULL DEFAULT true'],
    ['public_holidays_are_after_hours', 'BOOLEAN NOT NULL DEFAULT true'],
  ])('seeds %s as %s — the PR0-measured default, not a guess', (column, definition) => {
    expect(forward).toContain(`${column} ${definition}`);
  });

  it('seeds both permission keys, read-only stats wide and rule editing narrow', () => {
    // Plan §3.2. PR6's per-vehicle stats API gates on fleet.vehicle-stats;
    // editing a threshold arms and disarms detectors, so that stays with admins.
    expect(forward).toContain("'page', 'fleet.vehicle-stats'");
    expect(forward).toContain("'page', 'fleet.vehicle-rules'");
    const grants = forward.slice(forward.indexOf('INSERT INTO role_permissions'));
    for (const role of ['super_admin', 'admin', 'manager', 'project_manager', 'viewer']) {
      expect(grants, role).toContain(`('${role}', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'`);
    }
    for (const role of ['super_admin', 'admin']) {
      expect(grants, role).toContain(`('${role}', 'fleet.vehicle-rules', '{"view":true,"create":true,"edit":true,"delete":false}'`);
    }
    expect(grants).not.toMatch(/'(manager|project_manager|viewer)', 'fleet\.vehicle-rules'/);
  });

  it('seeds version 1 in the timezone the API validates against', () => {
    expect(forward).toContain(`VALUES (1, '${VEHICLE_RULE_TIMEZONE}', now())`);
  });

  it('adds after_hours_exempt additively and defaulted', () => {
    expect(forward).toContain('ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS after_hours_exempt BOOLEAN NOT NULL DEFAULT false');
  });

  it('grants the application role the access the rule editor needs, and no more', () => {
    expect(forward).toMatch(/REVOKE ALL ON fleet_vehicle_operational_rules FROM fibreflow_user/);
    expect(forward).toMatch(/GRANT SELECT, INSERT, UPDATE ON fleet_vehicle_operational_rules TO fibreflow_user/);
    expect(forward).not.toMatch(/GRANT[^;]*DELETE[^;]*fleet_vehicle_operational_rules/);
  });
});

describe('the rollback', () => {
  it('is one transaction, because psql autocommits statement by statement', () => {
    expect(rollback).toMatch(/^BEGIN;$/m);
    expect(rollback).toMatch(/^COMMIT;$/m);
  });

  it('has nothing to delete or reopen — 529 inserted no rows and closed none', () => {
    expect(rollback).not.toMatch(/DELETE FROM fleet_operational_incident_rules/i);
    expect(rollback).not.toContain('rb529_authored');
    expect(rollback).not.toMatch(/SET effective_to = NULL/i);
  });

  it('only touches rows still left `high` by 529', () => {
    // A row the operator has taken back to critical is theirs, marker or no
    // marker: rewriting its flags from a stale marker undoes their decision.
    const from = rollback.indexOf("SET severity = 'critical'");
    const statement = rollback.slice(from, rollback.indexOf(';', from));
    expect(statement).toContain("WHERE severity = 'high'");
  });

  it('restores from the marker values, not from seed constants', () => {
    const from = rollback.indexOf("SET severity = 'critical'");
    expect(from).toBeGreaterThan(-1);
    const statement = rollback.slice(from, rollback.indexOf(';', from));
    expect(statement).toContain('regexp_match(');
    expect(statement).toContain('[1]::boolean');
    expect(statement).toContain('[2]::boolean');
    expect(statement).toContain('[3]::boolean');
    expect(statement).not.toContain('whatsapp_enabled = true');
    expect(statement).not.toContain('immediate_notification = true');
    expect(statement).not.toContain('include_in_morning_summary = false');
    // Severity is the one value the filter pins, so it alone is a constant.
    expect(statement).toContain("severity = 'critical'");
    // Stripping the marker is what makes a second run a no-op.
    expect(statement).toContain('regexp_replace(change_reason');
  });

  it('matches the marker anchored to the END of change_reason', () => {
    // Prose that merely CONTAINS the marker mid-string must not be restored.
    expect(rollback).toContain(TELEMATICS_REVERSION_MARKER_PATTERN);
    expect(rollback).toMatch(/change_reason ~ '529:reversioned[^']*\$'/);
  });

  it('agrees with the TS marker constants exactly', () => {
    // The forward writes the marker literally; the rollback matches it as a
    // regex, so its braces are escaped. Both are pinned to the same constants.
    expect(forward).toContain(TELEMATICS_REVERSION_MARKER_PREFIX);
    expect(rollback).toContain(TELEMATICS_REVERSION_MARKER_PATTERN);
  });

  it('removes the table, the column, the permission rows and the migration record', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS fleet_vehicle_operational_rules');
    expect(rollback).toContain('ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS after_hours_exempt');
    for (const key of ['fleet.vehicle-rules', 'fleet.vehicle-stats']) {
      expect(rollback).toMatch(new RegExp(`DELETE FROM role_permissions[\\s\\S]*'${key.replace('.', '\\.')}'`));
      expect(rollback).toMatch(new RegExp(`DELETE FROM access_permissions[\\s\\S]*'${key.replace('.', '\\.')}'`));
    }
    expect(rollback).toContain("filename = '529_fleet_vehicle_operational_rules.sql'");
  });
});

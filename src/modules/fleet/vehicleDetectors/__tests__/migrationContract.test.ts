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
import { REVERSIONED_TELEMATICS_INCIDENT_TYPES, TELEMATICS_REVERSION_CHANGE_REASON } from '../types';

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

  it('are closed by severity, not by version — so a re-run is a no-op', () => {
    // `version = 1` was the first shape of this, and it was wrong: an operator
    // who had already created version 2 of a type through the settings UI would
    // see the close match nothing and the type stay critical. Scoping the close
    // to `severity = 'critical'` is self-limiting instead — after the migration
    // no open row among the four is critical.
    const close = forward.slice(forward.indexOf('UPDATE fleet_operational_incident_rules'));
    const statement = close.slice(0, close.indexOf(';'));
    expect(statement).toContain("severity = 'critical'");
    expect(statement).toContain('effective_to IS NULL');
    expect(statement).not.toMatch(/\bversion = \d/);
  });

  it('insert at max(version) + 1 per type, and never swallow a collision', () => {
    const insert = forward.slice(forward.indexOf('INSERT INTO fleet_operational_incident_rules'));
    const statement = insert.slice(0, insert.indexOf(';'));
    expect(statement).toContain('max(r.version) + 1');
    // A hard-coded 2 collides with an operator's own version 2, and
    // ON CONFLICT DO NOTHING would make that collision silent — leaving the
    // type critical with WhatsApp armed and the migration exiting 0.
    expect(statement).not.toMatch(/ON CONFLICT/i);
  });

  it('insert at severity high with WhatsApp off and the morning summary on', () => {
    // `requiresMandatoryIncidentWhatsApp` is severity === 'critical' &&
    // producerKind === 'source_event'. 'high' is the whole mechanism.
    const insert = forward.slice(forward.indexOf('INSERT INTO fleet_operational_incident_rules'));
    const statement = insert.slice(0, insert.indexOf(';'));
    expect(statement).toContain("'high'");
    expect(statement).not.toContain("'critical'");
    expect(statement).toContain('whatsapp_enabled, include_in_morning_summary');
    expect(statement).toContain(TELEMATICS_REVERSION_CHANGE_REASON);
  });

  it('close before opening, so the gist exclusion holds', () => {
    const updateAt = forward.indexOf('UPDATE fleet_operational_incident_rules');
    const insertAt = forward.indexOf('INSERT INTO fleet_operational_incident_rules');
    expect(updateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(updateAt);
  });

  it('carry no explicit BEGIN, because the runner already opens the transaction', () => {
    // scripts/migrations/run.ts wraps every forward file in BEGIN/COMMIT. An
    // explicit BEGIN here nests and the COMMIT would end the runner's
    // transaction early, splitting the close and the insert into two commits.
    expect(forward).not.toMatch(/^\s*BEGIN\s*;/mi);
    expect(forward).not.toMatch(/^\s*COMMIT\s*;/mi);
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
    // Removing 529's rows without reopening what they replaced leaves four
    // incident types with no effective rule at all.
    expect(rollback).toMatch(/^BEGIN;$/m);
    expect(rollback).toMatch(/^COMMIT;$/m);
  });

  it('removes only the rows 529 authored, by change reason — never "version 2"', () => {
    const del = rollback.slice(rollback.indexOf('DELETE FROM fleet_operational_incident_rules'));
    const statement = del.slice(0, del.indexOf(';'));
    expect(statement).toContain(TELEMATICS_REVERSION_CHANGE_REASON);
    expect(statement).toContain("severity = 'high'");
    // An operator may have authored their own version 2 of any of these types.
    expect(statement).not.toMatch(/\bversion = \d/);
  });

  it('reopens the newest closed critical row per type, and only if none is open', () => {
    const restore = rollback.slice(rollback.indexOf('WITH restore AS'));
    const statement = restore.slice(0, restore.indexOf(';'));
    expect(statement).toContain('DISTINCT ON (incident_type)');
    expect(statement).toContain("severity = 'critical'");
    expect(statement).toContain('ORDER BY incident_type, effective_to DESC, version DESC');
    expect(statement).toContain('NOT EXISTS');
    expect(statement).toContain('SET effective_to = NULL');
  });

  it('deletes before it reopens — the open-per-type index forbids the other order', () => {
    expect(rollback.indexOf('DELETE FROM fleet_operational_incident_rules'))
      .toBeLessThan(rollback.indexOf('WITH restore AS'));
    for (const list of reversionedTypeLists(rollback)) expect(list.sort()).toEqual(expectedTypes);
  });

  it('removes the table, the column, the permission rows and the migration record', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS fleet_vehicle_operational_rules');
    expect(rollback).toContain('ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS after_hours_exempt');
    expect(rollback).toMatch(/DELETE FROM role_permissions[\s\S]*'fleet\.vehicle-rules'/);
    expect(rollback).toMatch(/DELETE FROM access_permissions[\s\S]*'fleet\.vehicle-rules'/);
    expect(rollback).toContain("filename = '529_fleet_vehicle_operational_rules.sql'");
  });
});

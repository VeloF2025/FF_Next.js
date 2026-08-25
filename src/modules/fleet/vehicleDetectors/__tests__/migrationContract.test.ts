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
import { REVERSIONED_TELEMATICS_INCIDENT_TYPES } from '../types';

const SQL_DIR = resolve(process.cwd(), 'scripts/migrations/sql');
const forward = readFileSync(resolve(SQL_DIR, '529_fleet_vehicle_operational_rules.sql'), 'utf8');
const rollback = readFileSync(resolve(SQL_DIR, 'rollback_529_fleet_vehicle_operational_rules.sql'), 'utf8');

/** The types named inside the migration's `ARRAY[...]` re-version list. */
function reversionedTypesInSql(sql: string): string[] {
  const block = sql.match(/incident_type = ANY\(ARRAY\[([\s\S]*?)\]::text\[\]\)/);
  if (!block?.[1]) throw new Error('529 no longer re-versions an explicit incident-type list');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
}

describe('the re-versioned incident types', () => {
  it('are exactly the four the TS constant names', () => {
    expect(reversionedTypesInSql(forward).sort()).toEqual([...REVERSIONED_TELEMATICS_INCIDENT_TYPES].sort());
  });

  it('never include the two emergency types that must keep WhatsApp', () => {
    const types = reversionedTypesInSql(forward);
    expect(types).not.toContain('accident_sos');
    expect(types).not.toContain('theft_after_hours_movement');
  });

  it('are inserted at severity high with WhatsApp off and the morning summary on', () => {
    // `requiresMandatoryIncidentWhatsApp` is severity === 'critical' && producerKind
    // === 'source_event'. 'high' is the whole mechanism; 'critical' here would
    // arm a WhatsApp blast for every harsh-braking event.
    const block = forward.slice(forward.indexOf('INSERT INTO fleet_operational_incident_rules'));
    const values = block.slice(block.indexOf(') VALUES'), block.indexOf('ON CONFLICT (incident_type, version)'));
    const inserts = values.split(/\n\s*\(/).filter((row) => /^'[a-z_]+', 2,/.test(row.trim()));
    expect(inserts).toHaveLength(REVERSIONED_TELEMATICS_INCIDENT_TYPES.length);
    for (const insert of inserts) {
      expect(insert, insert).toContain("'high'");
      expect(insert, insert).not.toContain("'critical'");
    }
    expect(forward).toMatch(/INSERT INTO fleet_operational_incident_rules[\s\S]*whatsapp_enabled, include_in_morning_summary/);
  });

  it('close version 1 before opening version 2, so the gist exclusion holds', () => {
    const updateAt = forward.indexOf('UPDATE fleet_operational_incident_rules');
    const insertAt = forward.indexOf('INSERT INTO fleet_operational_incident_rules');
    expect(updateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(updateAt);
  });

  it('carry no explicit BEGIN, because the runner already opens the transaction', () => {
    // scripts/migrations/run.ts wraps every file in BEGIN/COMMIT. An explicit
    // BEGIN here nests (a warning) and the COMMIT ends the runner's transaction
    // early, which would split the close and the insert into two commits.
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
  it('deletes version 2 and explicitly reopens version 1 — in that order', () => {
    const deleteAt = rollback.indexOf('DELETE FROM fleet_operational_incident_rules');
    const reopenAt = rollback.indexOf('SET effective_to = NULL');
    expect(deleteAt).toBeGreaterThan(-1);
    // Reopening first would collide with ux_fleet_operational_incident_rules_open_type.
    expect(reopenAt).toBeGreaterThan(deleteAt);
    expect(reversionedTypesInSql(rollback).sort()).toEqual([...REVERSIONED_TELEMATICS_INCIDENT_TYPES].sort());
  });

  it('removes the table, the column, the permission rows and the migration record', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS fleet_vehicle_operational_rules');
    expect(rollback).toContain('ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS after_hours_exempt');
    expect(rollback).toMatch(/DELETE FROM role_permissions[\s\S]*'fleet\.vehicle-rules'/);
    expect(rollback).toMatch(/DELETE FROM access_permissions[\s\S]*'fleet\.vehicle-rules'/);
    expect(rollback).toContain("filename = '529_fleet_vehicle_operational_rules.sql'");
  });
});

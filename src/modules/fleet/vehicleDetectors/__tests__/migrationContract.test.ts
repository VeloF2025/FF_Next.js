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
  TELEMATICS_PENDING_REVERSION_MARKER,
  TELEMATICS_REVERSION_CHANGE_REASON,
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

/** Branch A: the single statement that closes ACTIVE rules and opens their replacements. */
function reversionStatement(): string {
  const from = forward.indexOf('WITH closed AS (');
  if (from < 0) throw new Error('529 no longer re-versions active rows in one statement');
  return forward.slice(from, forward.indexOf(';', from));
}

/** Branch B: the in-place update of PENDING rules. */
function pendingStatement(): string {
  const from = forward.indexOf('UPDATE fleet_operational_incident_rules\n   SET severity =');
  if (from < 0) throw new Error('529 no longer updates pending rows in place');
  return forward.slice(from, forward.indexOf(';', from));
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

  it('are closed by severity, not by version — so a re-run is a no-op', () => {
    // `version = 1` was the first shape of this, and it was wrong: an operator
    // who had already created version 2 of a type through the settings UI would
    // see the close match nothing and the type stay critical. Scoping the close
    // to `severity = 'critical'` is self-limiting instead — after the migration
    // no open row among the four is critical.
    const close = forward.slice(forward.indexOf('UPDATE fleet_operational_incident_rules'));
    const statement = close.slice(0, close.indexOf('RETURNING'));
    expect(statement).toContain("severity = 'critical'");
    expect(statement).toContain('effective_to IS NULL');
    expect(statement).not.toMatch(/\bversion = \d/);
  });

  it('closes and opens in ONE statement, so no execution mode can split the pair', () => {
    // As two statements this is atomic only where something supplies a
    // transaction. `psql -f` autocommits, and a failure between them leaves four
    // incident types with no open rule at all.
    const statement = reversionStatement();
    expect(statement).toContain('UPDATE fleet_operational_incident_rules');
    expect(statement).toContain('INSERT INTO fleet_operational_incident_rules');
    expect(forward).not.toContain('CREATE TEMP TABLE');
  });

  it('carries the closed row effective_to into the new row effective_from', () => {
    // Adjacency must be a DATA dependency, not two statements coincidentally
    // observing the same now(). The rollback finds what to reopen by exactly
    // this equality; if the instants could differ by a millisecond it would
    // silently reopen nothing and exit 0.
    const statement = reversionStatement();
    expect(statement).toContain('RETURNING incident_type, effective_to');
    expect(statement).toContain('closed.effective_to,');
    // The new row's effective_from is the carried value, never a fresh read.
    expect(statement).not.toMatch(/\n\s+now\(\),\n\s+true, 'high'/);
  });

  it('closes only ACTIVE open rows, never a pending one', () => {
    // range_order is CHECK (effective_to IS NULL OR effective_to > effective_from).
    // The incident-settings dialog only ever creates FUTURE activations, so an
    // open row with effective_from > now() is the normal product of using the
    // UI — and closing it at now() aborts the deploy.
    expect(reversionStatement()).toContain('effective_from < now()');
  });

  it('edits PENDING open rows in place, marker and all', () => {
    const statement = pendingStatement();
    // `>=`, not `>`: a row activating at exactly this transaction's now() would
    // otherwise be closed with effective_to = effective_from and fail the CHECK.
    expect(statement).toContain('effective_from >= now()');
    expect(statement).toContain('effective_to IS NULL');
    expect(statement).toContain("severity = 'critical'");
    expect(statement).toContain("severity = 'high'");
    expect(statement).toContain('whatsapp_enabled = false');
    expect(statement).toContain('immediate_notification = false');
    expect(statement).toContain('include_in_morning_summary = true');
    expect(statement).toContain(TELEMATICS_PENDING_REVERSION_MARKER);
    // In place: no new version, no range touched.
    expect(statement).not.toMatch(/INSERT INTO/i);
    expect(statement).not.toMatch(/effective_to\s*=\s*now\(\)/);
  });

  it('covers every open row exactly once between the two branches', () => {
    // `< now()` and `>= now()` are disjoint and total.
    expect(reversionStatement()).toContain('effective_from < now()');
    expect(pendingStatement()).toContain('effective_from >= now()');
  });

  it('insert at max(version) + 1 per type, and never swallow a collision', () => {
    const statement = reversionStatement();
    expect(statement).toContain('max(existing.version) + 1');
    // Per type. A global max hands a type a version unrelated to its own
    // history and breaks the (incident_type, version) sequence the audit reads.
    expect(statement).toContain('WHERE existing.incident_type = closed.incident_type');
    // A hard-coded 2 collides with an operator's own version 2, and
    // ON CONFLICT DO NOTHING would make that collision silent — leaving the
    // type critical with WhatsApp armed and the migration exiting 0.
    expect(statement).not.toMatch(/ON CONFLICT/i);
  });

  it('insert at severity high with WhatsApp off and the morning summary on', () => {
    // `requiresMandatoryIncidentWhatsApp` is severity === 'critical' &&
    // producerKind === 'source_event'. 'high' is the whole mechanism.
    const statement = reversionStatement();
    expect(statement).toContain("'high'");
    expect(statement).not.toContain("'critical', false");
    expect(statement).toContain('whatsapp_enabled, include_in_morning_summary');
    expect(statement).toContain(TELEMATICS_REVERSION_CHANGE_REASON);
  });

  it('closes before it opens, so the gist exclusion holds', () => {
    const statement = reversionStatement();
    expect(statement.indexOf('UPDATE fleet_operational_incident_rules'))
      .toBeLessThan(statement.indexOf('INSERT INTO fleet_operational_incident_rules'));
  });

  it('carry no explicit BEGIN — psql -1 already wraps the file AND its record', () => {
    // Measured on PostgreSQL 15: with an inner BEGIN/COMMIT, a failure in the
    // trailing `-c "INSERT INTO schema_migrations ..."` leaves the migration
    // APPLIED and UNRECORDED, and an unrecorded migration re-runs next deploy.
    // Atomicity for the one pair that needs it comes from being one statement.
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

  it('captures only the rows 529 authored and still has open', () => {
    const capture = rollback.slice(rollback.indexOf('CREATE TEMP TABLE rb529_authored'));
    const statement = capture.slice(0, capture.indexOf(';'));
    expect(statement).toContain(TELEMATICS_REVERSION_CHANGE_REASON);
    expect(statement).toContain("severity = 'high'");
    // A superseded 529 row stays: incidents opened while it was in force carry
    // its id in incident_rule_id, and the FK is ON DELETE SET NULL.
    expect(statement).toContain('effective_to IS NULL');
    // An operator may have authored their own version 2 of any of these types.
    expect(statement).not.toMatch(/\bversion = \d/);
  });

  it('reopens by the meeting instant, not by severity or version', () => {
    // 529 closes a row and opens its replacement in one transaction, so the
    // half-open ranges meet: closed.effective_to === authored.effective_from.
    // A "newest closed critical row" selection extends an older row to
    // 'infinity' straight through a later one and raises 23P01.
    const restore = rollback.slice(rollback.indexOf('UPDATE fleet_operational_incident_rules target'));
    const statement = restore.slice(0, restore.indexOf(';'));
    expect(statement).toContain('target.effective_to = authored.effective_from');
    expect(statement).toContain('target.incident_type = authored.incident_type');
    expect(statement).toContain('NOT EXISTS');
    expect(statement).toContain('SET effective_to = NULL');
    expect(statement).not.toMatch(/severity\s*=/);
    expect(statement).not.toMatch(/\bversion\b/);
  });

  it('deletes before it reopens — the open-per-type index forbids the other order', () => {
    expect(rollback.indexOf('DELETE FROM fleet_operational_incident_rules'))
      .toBeLessThan(rollback.indexOf('UPDATE fleet_operational_incident_rules target'));
    for (const list of reversionedTypeLists(rollback)) expect(list.sort()).toEqual(expectedTypes);
  });

  it('restores pending rows by the marker alone, and strips it', () => {
    const from = rollback.indexOf("SET severity = 'critical'");
    expect(from).toBeGreaterThan(-1);
    const statement = rollback.slice(from, rollback.indexOf(';', from));
    expect(statement).toContain(TELEMATICS_PENDING_REVERSION_MARKER);
    expect(statement).toContain('whatsapp_enabled = true');
    expect(statement).toContain('immediate_notification = true');
    expect(statement).toContain('include_in_morning_summary = false');
    // Stripping the marker is what makes a second run a no-op.
    expect(statement).toContain('regexp_replace(change_reason');
    // An operator's own pending `high` row carries no marker and is untouched.
    expect(statement).toContain("change_reason LIKE '%529: re-versioned pending row to high'");
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

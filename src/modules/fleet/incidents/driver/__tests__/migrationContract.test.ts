import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'scripts/migrations/sql/503_fleet_incident_driver_input.sql');
const rollbackPath = resolve(process.cwd(), 'scripts/migrations/sql/rollback_503_fleet_incident_driver_input.sql');

const newTables = [
  'fleet_incident_driver_input_settings',
  'fleet_incident_driver_input_requests',
  'fleet_incident_driver_submissions',
  'fleet_incident_attendance_correction_links',
] as const;

const appendOnlyTables = [
  'fleet_incident_driver_input_requests',
  'fleet_incident_driver_submissions',
  'fleet_incident_attendance_correction_links',
] as const;

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

function rollbackSql(): string {
  return readFileSync(rollbackPath, 'utf8');
}

describe('fleet incident driver-input migration contract', () => {
  it('stays within the new-file size ratchet', () => {
    // A ratchet, not a budget: pinned to the file's current length so any
    // growth has to be argued for, same convention as 502's contract test.
    expect(migrationSql().split(/\r?\n/).length).toBeLessThanOrEqual(156);
  });

  it('creates the effective-dated settings table plus the three append-only tables', () => {
    const sql = migrationSql();

    for (const table of newTables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
    }
    expect(sql).toMatch(/effective_from TIMESTAMPTZ NOT NULL/i);
    expect(sql).toMatch(/effective_to TIMESTAMPTZ/i);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS ux_fleet_incident_driver_input_settings_open/i);
    expect(sql).toMatch(/fleet_incident_driver_input_settings \(\(true\)\) WHERE effective_to IS NULL/i);
  });

  it('grants only workflow-required access: settings may be versioned, everything else is append-only', () => {
    const sql = migrationSql();

    for (const table of newTables) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON[\\s\\S]*?${table}[\\s\\S]*?FROM fibreflow_user`, 'i'));
    }
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON fleet_incident_driver_input_settings TO fibreflow_user/i);
    for (const table of appendOnlyTables) {
      expect(sql).toMatch(new RegExp(`GRANT SELECT, INSERT ON[\\s\\S]*?${table}[\\s\\S]*?TO fibreflow_user`, 'i'));
    }
    // No update/delete application grant exists for requests/submissions/links.
    const grantBlock = sql.match(/GRANT SELECT, INSERT ON[\s\S]*?TO fibreflow_user;/i)?.[0] ?? '';
    expect(grantBlock).not.toMatch(/UPDATE|DELETE/i);
    expect(sql).not.toMatch(/GRANT[^;]*(?:DELETE|TRUNCATE)[^;]*TO fibreflow_user/i);
  });

  it('enforces request idempotency uniqueness per incident', () => {
    expect(migrationSql()).toMatch(
      /fleet_incident_driver_input_requests_idempotency_unique UNIQUE \(incident_id, idempotency_key\)/i,
    );
  });

  it('enforces submission idempotency uniqueness per incident and staff member', () => {
    expect(migrationSql()).toMatch(
      /fleet_incident_driver_submissions_idempotency_unique UNIQUE \(incident_id, staff_id, idempotency_key\)/i,
    );
  });

  it('enforces one Attendance correction link per incident/correction pair', () => {
    expect(migrationSql()).toMatch(
      /fleet_incident_attendance_correction_links_unique UNIQUE \(incident_id, attendance_correction_id\)/i,
    );
  });

  it('preserves incident/staff history with restrictive or SET NULL foreign keys, never CASCADE', () => {
    const sql = migrationSql();

    expect(sql.match(/incident_id UUID NOT NULL REFERENCES fleet_operational_incidents\(id\) ON DELETE RESTRICT/gi))
      .toHaveLength(3);
    expect(sql).toMatch(/staff_id UUID NOT NULL REFERENCES staff\(id\) ON DELETE RESTRICT/i);
    expect(sql).toMatch(/input_request_id UUID REFERENCES fleet_incident_driver_input_requests\(id\) ON DELETE SET NULL/i);
    expect(sql).toMatch(/driver_submission_id UUID REFERENCES fleet_incident_driver_submissions\(id\) ON DELETE SET NULL/i);
    expect(sql).toMatch(/attendance_correction_id UUID NOT NULL REFERENCES attendance_adjustments\(id\) ON DELETE RESTRICT/i);
    expect(sql).not.toMatch(/ON DELETE CASCADE/i);
  });

  it('adds a visibility column to PR6 evidence and actions, defaulting to internal', () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /ALTER TABLE fleet_operational_incident_evidence[\s\S]*?ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'/i,
    );
    expect(sql).toMatch(
      /ALTER TABLE fleet_operational_incident_actions[\s\S]*?ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'/i,
    );
    expect(sql).toMatch(/fleet_operational_incident_evidence_visibility_check[\s\S]*?CHECK \(visibility IN \('internal', 'shared_with_driver', 'driver_submitted'\)\)/i);
    expect(sql).toMatch(/fleet_operational_incident_actions_visibility_check[\s\S]*?CHECK \(visibility IN \('internal', 'shared_with_driver', 'driver_submitted'\)\)/i);
  });

  it('lets a driver (staff, not a users row) be the recorded actor of a driver action', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS actor_staff_id UUID REFERENCES staff\(id\) ON DELETE RESTRICT/i);
    expect(sql).toMatch(
      /CHECK \(\(actor_user_id IS NOT NULL\)::int \+ \(actor_staff_id IS NOT NULL\)::int \+ is_system_actor::int = 1\)/i,
    );
    expect(sql).toMatch(/'driver_input_requested', 'driver_response_received'/i);
  });

  it('rolls back only PR7 objects and reverts the PR6 visibility extension in dependency-safe order', () => {
    const sql = rollbackSql();
    const dropOrder = [
      'fleet_incident_attendance_correction_links',
      'fleet_incident_driver_submissions',
      'fleet_incident_driver_input_requests',
      'fleet_incident_driver_input_settings',
    ];
    const positions = dropOrder.map((table) => sql.indexOf(`DROP TABLE IF EXISTS ${table}`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(sql).toContain("filename = '503_fleet_incident_driver_input.sql'");
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS fleet_operational_/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS visibility/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS actor_staff_id/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS uploaded_by_staff_id/i);
  });
});

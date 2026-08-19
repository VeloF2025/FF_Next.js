import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'scripts/migrations/sql/502_fleet_operational_incidents.sql');
const rollbackPath = resolve(process.cwd(), 'scripts/migrations/sql/rollback_502_fleet_operational_incidents.sql');

const tables = [
  'fleet_operational_incidents',
  'fleet_operational_incident_observations',
  'fleet_operational_incident_actions',
  'fleet_operational_incident_evidence',
  'fleet_operational_monitor_runs',
  'fleet_operational_incident_rules',
  'fleet_operational_oversight_members',
] as const;

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('fleet operational incidents migration contract', () => {
  it('stays within the new-file size ratchet', () => {
    expect(migrationSql().split(/\r?\n/).length).toBeLessThanOrEqual(300);
  });

  it('creates the complete durable incident model', () => {
    const sql = migrationSql();

    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
    }
  });

  it('grants only workflow-required access to every application table', () => {
    const sql = migrationSql();

    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON[\\s\\S]*?${table}[\\s\\S]*?FROM fibreflow_user`, 'i'));
    }
    for (const table of [
      'fleet_operational_incident_rules',
      'fleet_operational_oversight_members',
      'fleet_operational_monitor_runs',
      'fleet_operational_incidents',
    ]) {
      expect(sql).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE ON[\\s\\S]*?${table}[\\s\\S]*?TO fibreflow_user`, 'i'));
    }
    for (const table of ['fleet_operational_incident_observations', 'fleet_operational_incident_actions', 'fleet_operational_incident_evidence']) {
      expect(sql).toMatch(new RegExp(`GRANT SELECT, INSERT ON[\\s\\S]*?${table}[\\s\\S]*?TO fibreflow_user`, 'i'));
    }
    expect(sql).not.toMatch(/GRANT[^;]*(?:DELETE|TRUNCATE)[^;]*TO fibreflow_user/i);
  });

  it('seeds scheduled detectors, summary-only gaps, and source-only incidents distinctly', () => {
    const sql = migrationSql();

    for (const type of ['late', 'wrong_site', 'evidence_mismatch', 'left_early']) {
      expect(sql).toMatch(new RegExp(`\\('${type}', 1, now\\(\\), true, 'high'`, 'i'));
    }
    for (const type of ['unassigned', 'unverifiable', 'evidence_gap', 'vehicle_on_site_driver_unconfirmed']) {
      expect(sql).toMatch(new RegExp(`\\('${type}', 1, now\\(\\), false, 'normal'`, 'i'));
    }
    for (const type of ['accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement', 'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving']) {
      expect(sql).toMatch(new RegExp(`\\('${type}', 1, now\\(\\), true, 'critical', true, true, true, true`, 'i'));
    }
  });

  it('prevents duplicate active incidents and source-produced incidents', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/COALESCE\(operational_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid\)/i);
    expect(sql).toMatch(/WHERE lifecycle_status IN \('open', 'acknowledged', 'under_review'\)/i);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_incidents_source_event/i);
    expect(sql).toMatch(/\(incident_type, source_event_id\)\s*WHERE source_event_id IS NOT NULL/i);
  });

  it('preserves only materially new observations', () => {
    expect(migrationSql()).toMatch(/UNIQUE \(incident_id, observation_fingerprint\)/i);
  });

  it('preserves incident history and enforces lifecycle, outcome, and actor integrity', () => {
    const sql = migrationSql();

    expect(sql.match(/incident_id UUID NOT NULL REFERENCES fleet_operational_incidents\(id\) ON DELETE RESTRICT/gi)).toHaveLength(3);
    for (const actor of ['acknowledged_by', 'review_started_by', 'resolved_by']) {
      expect(sql).toMatch(new RegExp(`${actor} UUID REFERENCES users\\(id\\) ON DELETE RESTRICT`, 'i'));
    }
    expect(sql).toMatch(/fleet_operational_incidents_lifecycle_details_check/i);
    expect(sql).toMatch(/fleet_operational_incidents_terminal_outcome_check/i);
    expect(sql).toMatch(/outcome = 'duplicate' AND duplicate_incident_id IS NOT NULL AND duplicate_incident_id <> id/i);
    expect(sql).toMatch(/fleet_operational_incident_actions_actor_check CHECK \(\(actor_user_id IS NOT NULL\) <> is_system_actor\)/i);
  });

  it('pairs nullable rule references and accepts only positive versions', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/fleet_operational_incidents_status_rule_pair_check[\s\S]*?status_rule_version > 0/i);
    expect(sql).toMatch(/fleet_operational_incidents_incident_rule_pair_check[\s\S]*?incident_rule_version > 0/i);
    expect(sql).toMatch(/fleet_operational_incident_observations_rule_pair_check[\s\S]*?rule_version > 0/i);
  });

  it('keeps each incident-rule version stream non-overlapping', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/fleet_operational_incident_rules_no_overlap/i);
    expect(sql).toMatch(/incident_type WITH =/i);
    expect(sql).toMatch(/tstzrange\(effective_from, COALESCE\(effective_to, 'infinity'::timestamptz\), '\[\)'\) WITH &&/i);
  });

  it('allows one active oversight membership per user', () => {
    expect(migrationSql()).toMatch(/UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_oversight_members_active_user/i);
    expect(migrationSql()).toMatch(/ON fleet_operational_oversight_members \(user_id\)\s*WHERE effective_to IS NULL/i);
  });

  it('seeds both RBAC permissions and only the approved roles', () => {
    const sql = migrationSql();

    expect(sql).toContain("'fleet.incidents'");
    expect(sql).toContain("'fleet.incidents-settings'");
    for (const role of ['super_admin', 'admin', 'manager', 'project_manager']) {
      expect(sql).toContain(`('${role}', 'fleet.incidents'`);
    }
    expect(sql).not.toContain("('manager', 'fleet.incidents-settings'");
    expect(sql).not.toContain("('project_manager', 'fleet.incidents-settings'");
  });

  it('rolls back only PR6 objects in dependency-safe reverse order', () => {
    const sql = readFileSync(rollbackPath, 'utf8');
    const dropOrder = [
      'fleet_operational_incident_evidence',
      'fleet_operational_incident_actions',
      'fleet_operational_incident_observations',
      'fleet_operational_incidents',
      'fleet_operational_monitor_runs',
      'fleet_operational_oversight_members',
      'fleet_operational_incident_rules',
    ];
    const positions = dropOrder.map((table) => sql.indexOf(`DROP TABLE IF EXISTS ${table}`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(sql).toContain("filename = '502_fleet_operational_incidents.sql'");
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS (?!fleet_operational_)/i);
    expect(sql).toContain("permission_key IN ('fleet.incidents', 'fleet.incidents-settings')");
    expect(sql).toContain("key IN ('fleet.incidents', 'fleet.incidents-settings')");
  });
});

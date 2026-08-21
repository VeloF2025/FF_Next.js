/**
 * TS <-> SQL contract for PR8 (migration 518).
 *
 * This file deliberately does NOT need a database. Its job is the one thing a
 * real-Postgres test cannot do cheaply: prove the TypeScript unions in
 * `../types` and the CHECK lists in the migration are the SAME closed sets, so
 * a value can never be legal in one layer and rejected by the other.
 *
 * The behavioural half — that the constraints and triggers actually fire — is
 * `tests/migrations/518_fleet_operational_analytics_retention.test.ts`, which
 * applies the real SQL to a real Postgres. Both are needed: string-scanning SQL
 * cannot prove a trigger fires, and a live-DB test cannot see a TS union.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGGREGATE_DIMENSION_LEVELS,
  AGGREGATE_METRIC_KINDS,
  DURATION_BUCKET_BOUNDS,
  DURATION_BUCKET_COLUMNS,
  FORBIDDEN_AGGREGATE_COLUMN_TOKENS,
  OPERATIONS_METRIC_KEYS,
  PUBLIC_AGGREGATE_COLUMNS,
  RETENTION_HOLD_ACTION_TYPES,
  RETENTION_HOLD_CATEGORIES,
  RETENTION_HOLD_STATUSES,
  RETENTION_ITEM_STAGES,
  RUN_STATUSES,
  TIMELINE_SOURCES,
} from '../types';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_518_fleet_operational_analytics_retention.sql'), 'utf8');

/** Pull the quoted literals out of `CONSTRAINT <name> CHECK (<col> IN (...))`. */
function checkList(constraintName: string): string[] {
  const pattern = new RegExp(
    `CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(\\s*[a-z_]+\\s+IN\\s*\\(([^)]*)\\)`,
    'i',
  );
  const match = FORWARD.match(pattern);
  if (!match) throw new Error(`no IN-list CHECK named ${constraintName} in migration 518`);
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

describe('migration 518 closed value sets match the TypeScript unions', () => {
  it.each([
    ['fleet_operational_monthly_aggregates_dimension_level_check', AGGREGATE_DIMENSION_LEVELS],
    ['fleet_operational_monthly_aggregates_metric_kind_check', AGGREGATE_METRIC_KINDS],
    ['fleet_operational_monthly_aggregates_metric_key_check', OPERATIONS_METRIC_KEYS],
    ['fleet_incident_retention_holds_category_check', RETENTION_HOLD_CATEGORIES],
    ['fleet_incident_retention_holds_status_check', RETENTION_HOLD_STATUSES],
    ['fleet_incident_retention_hold_actions_type_check', RETENTION_HOLD_ACTION_TYPES],
    ['fleet_operational_retention_items_stage_check', RETENTION_ITEM_STAGES],
    ['fleet_operational_retention_runs_status_check', RUN_STATUSES],
    ['fleet_operational_aggregation_runs_status_check', RUN_STATUSES],
  ])('%s is exactly its union', (constraintName, union) => {
    expect(checkList(constraintName as string).slice().sort()).toEqual([...(union as readonly string[])].sort());
  });

  // The generalization source level is the same closed set, expressed as a
  // nullable column, so it needs its own (differently shaped) assertion.
  it('restricts generalized_from_level to the dimension levels', () => {
    for (const level of AGGREGATE_DIMENSION_LEVELS) {
      expect(FORWARD).toContain(`'${level}'`);
    }
    expect(FORWARD).toMatch(
      /CONSTRAINT fleet_operational_monthly_aggregates_generalized_check\s+CHECK\s*\(\s*generalized_from_level IS NULL OR generalized_from_level IN \(/i,
    );
  });

  // TimelineSource has no SQL counterpart on purpose: a timeline entry is
  // merged in memory from existing PR4-7 tables (Task 6) and is never stored.
  // Assert that explicitly so a future reader does not "fix" the omission by
  // inventing a timeline table.
  it('keeps TimelineSource out of the schema', () => {
    expect(TIMELINE_SOURCES.length).toBeGreaterThan(0);
    expect(FORWARD).not.toMatch(/timeline/i);
  });
});

describe('migration 518 aggregate column surface', () => {
  it('declares exactly the columns PUBLIC_AGGREGATE_COLUMNS names, in order', () => {
    const body = FORWARD.match(
      /CREATE TABLE IF NOT EXISTS fleet_operational_monthly_aggregates \(([\s\S]*?)\n\);/,
    );
    expect(body).not.toBeNull();
    const lines = body![1]!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('--'));
    const firstConstraint = lines.findIndex((line) => line.startsWith('CONSTRAINT'));
    expect(firstConstraint).toBeGreaterThan(0);
    const declared = lines.slice(0, firstConstraint).map((line) => line.split(/\s+/)[0]!);
    expect(declared).toEqual([...PUBLIC_AGGREGATE_COLUMNS]);
    // Postgres also accepts a column declared AFTER a table constraint, which
    // would slip past the slice above. Nothing in the tail may look like one.
    for (const line of lines.slice(firstConstraint)) {
      expect(line).not.toMatch(
        /^[a-z_]+ +(UUID|TEXT|INTEGER|BIGINT|SMALLINT|BOOLEAN|DATE|TIMESTAMPTZ|NUMERIC|JSONB|JSON)\b/,
      );
    }
  });

  // The point of the allow-list is that it is hostile to growth. If someone
  // adds `driver_id` or `resolution_note` to the aggregate table, the equality
  // above fails first; this catches the same mistake made in the constant.
  it('names no column containing an identity token', () => {
    for (const column of PUBLIC_AGGREGATE_COLUMNS) {
      for (const token of FORBIDDEN_AGGREGATE_COLUMN_TOKENS) {
        expect(column).not.toContain(token);
      }
    }
  });

  it('keeps the histogram bucket columns aligned with the bucket bounds', () => {
    expect(DURATION_BUCKET_COLUMNS).toHaveLength(DURATION_BUCKET_BOUNDS.length + 1);
    for (const column of DURATION_BUCKET_COLUMNS) {
      expect(PUBLIC_AGGREGATE_COLUMNS as readonly string[]).toContain(column);
    }
  });
});

describe('rollback 518', () => {
  const PR8_TABLES = [
    'fleet_operational_retention_items',
    'fleet_operational_retention_runs',
    'fleet_incident_retention_hold_actions',
    'fleet_incident_retention_holds',
    'fleet_operational_monthly_aggregates',
    'fleet_operational_aggregation_runs',
    'fleet_operational_analytics_settings',
  ];

  it('drops every PR8 table in reverse dependency order', () => {
    const dropped = [...ROLLBACK.matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)].map((m) => m[1]!);
    expect(dropped).toEqual(PR8_TABLES);
  });

  it('drops the incident purge guard before the tables its body reads', () => {
    const triggerAt = ROLLBACK.indexOf('DROP TRIGGER IF EXISTS trg_fleet_incident_purge_guard');
    const firstTableAt = ROLLBACK.indexOf('DROP TABLE IF EXISTS');
    expect(triggerAt).toBeGreaterThanOrEqual(0);
    expect(triggerAt).toBeLessThan(firstTableAt);
  });

  // A PR8 rollback that touched a PR4-7 table would silently destroy incident
  // evidence that PR8 never created.
  it('touches no PR4-7 incident table', () => {
    for (const table of [
      'fleet_operational_incidents',
      'fleet_operational_incident_evidence',
      'fleet_operational_incident_actions',
      'fleet_operational_incident_observations',
      'fleet_incident_driver_submissions',
    ]) {
      expect(ROLLBACK).not.toMatch(new RegExp(`DROP TABLE IF EXISTS ${table}\\b`));
      expect(ROLLBACK).not.toMatch(new RegExp(`DELETE FROM ${table}\\b`));
    }
  });

  it('removes only its own schema_migrations row', () => {
    expect(ROLLBACK).toContain(
      "DELETE FROM schema_migrations\n WHERE filename = '518_fleet_operational_analytics_retention.sql'",
    );
  });
});

/**
 * The TypeScript union and the database CHECK are the same closed set, or one of them is lying.
 *
 * No database here on purpose: this reads migration 528's text. A drift between the two is a
 * runtime 23514 on a row the type system said was fine, which is exactly the failure that is
 * cheapest to catch in a unit test and most expensive to catch in production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COVERAGE_GRANULARITIES } from '../types';

const MIGRATION = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/528_fleet_vehicle_daily_stats.sql'),
  'utf8',
);
const ROLLBACK = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/rollback_528_fleet_vehicle_daily_stats.sql'),
  'utf8',
);

describe('coverage_granularity', () => {
  it('names exactly the values the TypeScript union does', () => {
    const check = /coverage_granularity IN \(([^)]*)\)/.exec(MIGRATION);
    expect(check, 'the CHECK constraint was not found in 528').not.toBeNull();
    const inSql = check![1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
    expect([...inSql].sort()).toEqual([...COVERAGE_GRANULARITIES].sort());
  });

  it('is not vacuous — the union is not empty', () => {
    expect(COVERAGE_GRANULARITIES.length).toBe(4);
  });
});

describe('what 528 creates and what its rollback undoes', () => {
  const created = ['fleet_vehicle_daily_stats', 'fleet_daily_stats_watermarks'];

  it('rolls back every table it creates', () => {
    for (const table of created) {
      expect(MIGRATION, table).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
      expect(ROLLBACK, table).toMatch(new RegExp(`DROP TABLE IF EXISTS ${table}\\b`));
    }
  });

  it('rolls back the column it adds to the position stream', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE fleet_vehicle_positions ADD COLUMN IF NOT EXISTS provider_event_type TEXT/);
    expect(ROLLBACK).toMatch(/ALTER TABLE fleet_vehicle_positions DROP COLUMN IF EXISTS provider_event_type/);
  });

  it('grants the application role every privilege the build service needs', () => {
    for (const table of created) {
      expect(MIGRATION, table).toMatch(
        new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO fibreflow_user;`),
      );
    }
  });
});

/**
 * Migration 504: hs_daily_checkins.work_location.
 *
 * There is no live-Postgres harness for migration tests in this module —
 * checkinSchemaSync.test.ts (the existing pattern for this table) asserts
 * against the migration's SQL text, not a running database, so this file
 * follows the same approach rather than inventing a new harness. It pins the
 * exact constraint shapes so a later edit cannot silently soften them:
 *
 *   hs_daily_checkins_work_location_check — only 'site' or 'office'.
 *   hs_daily_checkins_site_needs_project  — a site row must carry a project.
 *
 * The DEFAULT 'site' on the new column is also pinned: checkinCrewWrite.ts's
 * separate INSERT into this table names its columns explicitly and does not
 * name work_location, so dropping the default would silently break that
 * writer's rows.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/504_hs_checkin_work_location.sql';
const ROLLBACK_PATH = 'scripts/migrations/sql/rollback_504_hs_checkin_work_location.sql';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('migration 504: hs_daily_checkins.work_location', () => {
  const migration = read(MIGRATION_PATH);

  it('adds work_location as NOT NULL, defaulted to site', () => {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS work_location text NOT NULL DEFAULT 'site'/
    );
  });

  it('makes project_id nullable', () => {
    expect(migration).toMatch(/ALTER COLUMN project_id DROP NOT NULL/);
  });

  it('restricts work_location to site or office', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_work_location_check\s+CHECK \(work_location IN \('site', 'office'\)\)/
    );
  });

  it('requires a project for a site declaration only', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_site_needs_project\s+CHECK \(work_location <> 'site' OR project_id IS NOT NULL\)/
    );
  });

  it('is idempotent: guards every structural change', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS work_location/);
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check/
    );
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project/
    );
  });
});

describe('rollback 504', () => {
  const rollback = read(ROLLBACK_PATH);

  it('deletes office rows before restoring the NOT NULL they cannot satisfy', () => {
    const deleteIdx = rollback.search(/DELETE FROM hs_daily_checkins WHERE work_location = 'office'/);
    const setNotNullIdx = rollback.search(/ALTER COLUMN project_id SET NOT NULL/);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(setNotNullIdx).toBeGreaterThan(deleteIdx);
  });

  it('drops both constraints and the column', () => {
    expect(rollback).toMatch(/DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project/);
    expect(rollback).toMatch(/DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS work_location/);
  });
});

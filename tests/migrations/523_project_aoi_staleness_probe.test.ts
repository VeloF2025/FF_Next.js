if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  AOI_CATALOG_SQL,
  AOI_STATE_WITHOUT_STATUS_SQL,
  AOI_STATE_WITH_STATUS_SQL,
  probeAoiFreshness,
  type AoiCatalogRow,
  type AoiStateRow,
} from '../../src/modules/attendance/alerts/projectAoiStalenessProbe';
import { AOI_STALE_AFTER_MS } from '../../src/modules/attendance/alerts/projectAoiStaleness';

const SCHEMA = 'mig523_aoi_staleness_probe_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const MIG_499 = readFileSync(join(SQL_DIR, '499_attendance_project_aois.sql'), 'utf8');
const MIG_523 = readFileSync(join(SQL_DIR, '523_project_aoi_outlier_guard.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

const PROJECT = '11111111-1111-4111-8111-111111111111';

// Mirrors public.projects / public.poles / public.staff / public.attendance_entries
// on the shared production database, checked against information_schema on
// 2026-08-21: every NOT NULL column present, with matching types, varchar
// lengths and numeric precision/scale. `project_aois` itself is deliberately
// NOT hand-rolled here — migration 499 creates it, which is the only fixture
// that cannot drift from the thing under test.
const PREREQUISITES = `
  CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code VARCHAR(50) NOT NULL,
    project_name VARCHAR(255) NOT NULL
  );
  CREATE TABLE poles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pole_number VARCHAR(100) NOT NULL,
    project_id UUID,
    latitude NUMERIC(10,8),
    longitude NUMERIC(11,8)
  );
  CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL
  );
  CREATE TABLE attendance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL,
    work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open'
  );
`;

const NOW = Date.parse('2026-08-22T01:15:00.000Z');
const HOUR = 60 * 60 * 1000;

/** Runs the probe's real query function against the scratch schema. */
const query = async <R>(text: string): Promise<R[]> => (await db.query(text)).rows as R[];

async function seedPoles(): Promise<void> {
  await db.query(`INSERT INTO projects (id, project_code, project_name)
    VALUES ('${PROJECT}','P1','Probe site')`);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const a = (2 * Math.PI * i) / 12;
    return `('P1-${i}', '${PROJECT}', ${(-26.38 + 0.01 * Math.cos(a)).toFixed(8)}, ${(27.81 + 0.01 * Math.sin(a)).toFixed(8)})`;
  });
  await db.query(`INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES ${rows.join(',')}`);
}

/** Move every hull's computed_at back, as a stalled refresh would leave it. */
async function ageRefresh(hoursAgo: number): Promise<void> {
  await db.query(`UPDATE project_aois SET computed_at = NOW() - INTERVAL '${hoursAgo} hours'`);
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query('CREATE EXTENSION IF NOT EXISTS postgis');
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await db.query(PREREQUISITES);
});

describe('project AOI staleness probe — real SQL', () => {
  it('reports unknown, and never alerts, when project_aois does not exist', async () => {
    const catalog = await query<AoiCatalogRow>(AOI_CATALOG_SQL);
    expect(catalog[0].has_table).toBe(false);
    expect(catalog[0].has_status).toBe(false);
    const freshness = await probeAoiFreshness(query, NOW);
    expect(freshness.state).toBe('unknown');
  });

  describe('before migration 523 lands', () => {
    beforeEach(async () => {
      await seedPoles();
      await db.query(MIG_499);
    });

    it('sees the table but not the status column', async () => {
      const catalog = await query<AoiCatalogRow>(AOI_CATALOG_SQL);
      expect(catalog[0].has_table).toBe(true);
      expect(catalog[0].has_status).toBe(false);
    });

    it('would break without that guard — the 523 query is a hard error here', async () => {
      // This is why the catalog lookup exists. 42703 is undefined_column; on a
      // per-minute production probe it would be a log line every 60 seconds
      // until the migration landed.
      await expect(db.query(AOI_STATE_WITH_STATUS_SQL)).rejects.toMatchObject({ code: '42703' });
    });

    it('still classifies a fresh refresh correctly on the pre-523 query', async () => {
      const rows = await query<AoiStateRow>(AOI_STATE_WITHOUT_STATUS_SQL);
      expect(Number(rows[0].row_count)).toBe(1);
      expect(Number(rows[0].unscored_count)).toBe(0);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('current');
      expect(freshness.rowCount).toBe(1);
    });

    it('still detects a stopped refresh on the pre-523 query', async () => {
      // The liveness half must work before the guard migration ships, or the
      // gap stays open until 523 is deployed everywhere.
      await ageRefresh(72);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('not_running');
      expect(freshness.ageMs).toBeGreaterThan(AOI_STALE_AFTER_MS);
    });
  });

  describe('after migration 523 lands', () => {
    beforeEach(async () => {
      await seedPoles();
      await db.query(MIG_499);
      await db.query(MIG_523);
    });

    it('sees the status column and reads a real refresh as current', async () => {
      const catalog = await query<AoiCatalogRow>(AOI_CATALOG_SQL);
      expect(catalog[0].has_table).toBe(true);
      expect(catalog[0].has_status).toBe(true);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('current');
      expect(freshness.unscoredCount).toBe(0);
    });

    it('reports a stopped refresh', async () => {
      await ageRefresh(72);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('not_running');
    });

    it('does not report a single missed run', async () => {
      await ageRefresh(48);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('current');
    });

    it('counts rows the refresh left on the column default', async () => {
      // `unassessed` after a refresh means the scoring did not reach the row —
      // a live job with a dead guard, which the "not running" alert would
      // misdiagnose.
      await db.query(`UPDATE project_aois SET aoi_status = 'unassessed'`);
      const rows = await query<AoiStateRow>(AOI_STATE_WITH_STATUS_SQL);
      expect(Number(rows[0].unscored_count)).toBe(1);
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('rows_unscored');
      expect(freshness.unscoredCount).toBe(1);
    });

    it('reports an emptied table as not running rather than as fresh', async () => {
      await db.query('DELETE FROM project_aois');
      const rows = await query<AoiStateRow>(AOI_STATE_WITH_STATUS_SQL);
      // The aggregate returns a row even over no rows — that is what keeps the
      // "never ran" case from arriving as an empty result set.
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].row_count)).toBe(0);
      expect(rows[0].newest_computed_at).toBeNull();
      const freshness = await probeAoiFreshness(query, Date.now());
      expect(freshness.state).toBe('not_running');
      expect(freshness.ageMs).toBeNull();
    });

    it('reads computed_at as a real instant, not a locale-shifted string', async () => {
      // computed_at is timestamptz and the container session is UTC; ::text
      // must still round-trip through Date.parse into the same instant, or a
      // fresh refresh could read as two hours stale in SAST.
      const rows = await query<AoiStateRow>(AOI_STATE_WITH_STATUS_SQL);
      const parsed = Date.parse(rows[0].newest_computed_at as string);
      expect(Number.isFinite(parsed)).toBe(true);
      // An hour is the tightest bound that still proves no timezone shift:
      // SAST is UTC+2, so a locale-shifted read would be off by 2h, not 5min.
      expect(Math.abs(Date.now() - parsed)).toBeLessThan(HOUR);
    });
  });
});

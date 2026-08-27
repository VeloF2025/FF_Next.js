/**
 * The nightly cron actually calls the new refresh.
 *
 * Asserted by RUNNING the shipped `scripts/cron/refresh-project-aois.ts`
 * against a real database, not by grepping its source. A source assertion
 * would pass for a call sitting in a dead branch, behind the `--dry-run`
 * early return, or before the zero-AOI guard — which are precisely the
 * placements that break this wiring.
 *
 * The script is pointed at a scratch schema through DATABASE_URL. Its own
 * dotenv calls do not override an environment variable that is already set,
 * so this wins over any .env file on the runner.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

const SCHEMA = 'mig531_cron_wiring_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const read = (f: string): string => readFileSync(join(SQL_DIR, f), 'utf8');

const PROJECT = '53100000-0000-4000-8000-000000000001';

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
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
  CREATE TABLE fleet_project_operational_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_aoi_id UUID
  );
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  for (const file of [
    '427_fno_atlas_gis_foundation.sql',
    '434_fno_atlas_project_aois.sql',
    '435_fno_atlas_velocity_aoi_labels.sql',
    '499_attendance_project_aois.sql',
    '523_project_aoi_outlier_guard.sql',
    '531_velocity_site_aois.sql',
  ]) {
    await db.query(read(file));
  }
  await db.query(
    `INSERT INTO projects (id, project_code, project_name) VALUES ($1, 'M531C', 'Migration 531 Cron')`,
    [PROJECT],
  );
  const rows: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (2 * Math.PI * i) / 8;
    rows.push(
      `('P-cron-${i}', '${PROJECT}', ${(-26.1 + 0.004 * Math.sin(angle)).toFixed(8)}, ${(28.4 + 0.004 * Math.cos(angle)).toFixed(8)})`,
    );
  }
  await db.query(`INSERT INTO poles (pole_number, project_id, latitude, longitude) VALUES ${rows.join(',')}`);
  // Deliberately NOT refreshed here — the cron run below is what must create
  // both the hull and the site AOI.
}, 180_000);

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

async function runCron(args: string[] = []): Promise<{ stderr: string }> {
  const { stderr } = await execFileAsync(
    'npx',
    ['tsx', 'scripts/cron/refresh-project-aois.ts', ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: SCOPED_URL,
        // The distortion alerter is best-effort and must not reach a bridge
        // from a test; with every hull `ok` it has nothing to send anyway.
        ATTENDANCE_OPS_WA_GROUP_JID: '',
      },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return { stderr };
}

async function siteAoiCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM fno_atlas_project_aois a
       JOIN fno_atlas_sources s ON s.id = a.source_id
      WHERE s.source_url = 'fibreflow://project_aois' AND a.retired_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

describe('refresh-project-aois cron', () => {
  it('does not touch site geometry on a dry run', async () => {
    await db.query('DELETE FROM fno_atlas_project_aois');
    const { stderr } = await runCron(['--dry-run']);
    expect(stderr).toContain('dry run — no changes written');
    expect(stderr).not.toContain('velocity site AOIs refreshed');
    expect(await siteAoiCount()).toBe(0);
  }, 180_000);

  it('refreshes the Velocity site AOIs in the same run as the pole hulls', async () => {
    await db.query('DELETE FROM fno_atlas_project_aois');
    await db.query('DELETE FROM project_aois');

    const { stderr } = await runCron();

    expect(stderr).toContain('velocity site AOIs refreshed: 1');
    expect(await siteAoiCount()).toBe(1);

    const { rows } = await db.query<{ site_code: string; area_name: string }>(
      `SELECT a.site_code, a.area_name
         FROM fno_atlas_project_aois a
         JOIN fno_atlas_sources s ON s.id = a.source_id
        WHERE s.source_url = 'fibreflow://project_aois' AND a.retired_at IS NULL`,
    );
    expect(rows[0]).toMatchObject({ site_code: PROJECT, area_name: 'Migration 531 Cron' });
  }, 180_000);
});

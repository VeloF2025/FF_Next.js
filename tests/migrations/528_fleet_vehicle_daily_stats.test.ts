/**
 * Contract for migration 528, against real Postgres.
 *
 * The unit tests beside the fold assert what the TypeScript computes. That says nothing about what
 * the database will accept, and every CHECK in 528 exists to make a specific fabrication
 * unstorable -- a snapshot feed claiming ignition seconds, a zero-g vehicle-day claiming harsh
 * counts, a fold that booked one sampling interval into both the moving and the idle bucket. A
 * constraint that is never exercised is a comment, so each one is driven to a rejection here.
 *
 * It also runs the grants under `SET ROLE fibreflow_user`. Migration tests connect as the schema
 * owner, which is effectively a superuser for these tables, so every INSERT passes whether the
 * GRANT landed or not; the production application role is the only one whose failure mode matters,
 * and 42501 in production is the thing this file is here to prevent.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { COVERAGE_GRANULARITIES } from '@/modules/fleet/dailyStats/types';

const SCHEMA = 'mig528_vehicle_daily_stats_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const scoped = (extra = '') =>
  `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}${extra}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const TRACKING = readFileSync(join(SQL_DIR, '441_fleet_live_tracking.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '528_fleet_vehicle_daily_stats.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_528_fleet_vehicle_daily_stats.sql'), 'utf8');

const VEHICLE = '11111111-1111-4111-8111-111111111111';
const WORK_DATE = '2026-08-10';

/**
 * What 441 expects to already exist, plus the one table it ALTERs.
 *
 * Column names and types mirror production; a fixture may be a subset, never a re-typing.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL);
  CREATE TABLE fleet_gps_trips (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', 'MIG528GP');
`;

/**
 * Production already grants the application role write access to the position stream -- the ingest
 * runs as fibreflow_user. 441 does not carry that grant, so the fixture states it, and the case
 * below then asserts the thing 528 is actually responsible for: that adding a column needs no new
 * grant, because column privileges follow the table's.
 */
const POSITION_GRANTS = 'GRANT SELECT, INSERT, UPDATE ON fleet_vehicle_positions TO fibreflow_user;';

/** A row that satisfies every constraint. Each case below breaks exactly one thing about it. */
const GOOD_ROW: Readonly<Record<string, unknown>> = {
  vehicle_id: VEHICLE,
  work_date: WORK_DATE,
  ignition_seconds: 3_600,
  moving_seconds: 2_400,
  idle_seconds: 1_000,
  distance_km: 42.5,
  max_speed_kph: 118,
  speeding_events: 2,
  speeding_seconds: 90,
  harsh_brake_events: 1,
  harsh_accel_events: 0,
  harsh_corner_events: 3,
  first_ignition_at: '2026-08-10T06:00:00+02:00',
  last_ignition_at: '2026-08-10T17:00:00+02:00',
  position_count: 1_169,
  tracker_silence_seconds: 298,
  provider: 'cartrack',
  account_ref: 'velocity',
  coverage_granularity: 'history',
  coverage_ignition: true,
  coverage_gforce: true,
  coverage_provider_events: true,
  coverage_complete: true,
  source_watermark: '2026-08-10T17:04:00+02:00',
};

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: scoped(), ssl: false, max: 1 });
const appRole = new Pool({ connectionString: scoped(' -c role=fibreflow_user'), ssl: false, max: 1 });

function insert(pool: Pool, overrides: Record<string, unknown> = {}) {
  const row = { ...GOOD_ROW, ...overrides };
  const keys = Object.keys(row);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  return pool.query(
    `INSERT INTO fleet_vehicle_daily_stats (${keys.join(', ')}) VALUES (${placeholders})`,
    keys.map((k) => row[k]),
  );
}

/** Postgres reports every CHECK, and only a CHECK, as 23514. */
async function expectRejected(overrides: Record<string, unknown>): Promise<void> {
  await expect(insert(db, overrides)).rejects.toMatchObject({ code: '23514' });
}

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
  await db.query(TRACKING);
  await db.query(POSITION_GRANTS);
}, 120_000);

afterAll(async () => {
  await appRole.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // Back to the pre-528 state, so nothing below can pass because of a previous case.
  await db.query(ROLLBACK);
  await db.query(FORWARD);
  await db.query('DELETE FROM fleet_vehicle_daily_stats');
  await db.query('DELETE FROM fleet_daily_stats_watermarks');
  // The position stream survives the rollback by design, so it has to be cleared explicitly or
  // a later case counts rows an earlier one left behind.
  await db.query('DELETE FROM fleet_vehicle_positions');
});

describe('the position stream column', () => {
  it('adds provider_event_type as a nullable TEXT column', async () => {
    const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'fleet_vehicle_positions'
          AND column_name = 'provider_event_type'`, [SCHEMA],
    );
    expect(rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
  });

  it('accepts the provider vocabulary verbatim and accepts null', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_positions
         (vehicle_id, provider, account_ref, recorded_at, lat, lon, provider_event_type)
       VALUES ($1, 'cartrack', 'velocity', now(), -26.2041, 28.0473, 'HARSH_CORNERING'),
              ($1, 'netstar', 'europcar', now(), -26.2041, 28.0473, NULL)`, [VEHICLE],
    );
    const { rows } = await db.query<{ provider_event_type: string | null }>(
      'SELECT provider_event_type FROM fleet_vehicle_positions ORDER BY provider',
    );
    expect(rows.map((r) => r.provider_event_type)).toEqual(['HARSH_CORNERING', null]);
  });

  it('is repeatable — re-applying does not fail on the existing column', async () => {
    await expect(db.query(FORWARD)).resolves.toBeTruthy();
  });
});

describe('the row the fold produces', () => {
  it('is accepted', async () => {
    await expect(insert(db)).resolves.toBeTruthy();
  });

  it('computes unattributed_seconds itself and refuses to let a caller assign it', async () => {
    await insert(db);
    const { rows } = await db.query<{ unattributed_seconds: string }>(
      'SELECT unattributed_seconds FROM fleet_vehicle_daily_stats',
    );
    expect(Number(rows[0]!.unattributed_seconds)).toBe(200);
    await expect(insert(db, { work_date: '2026-08-11', unattributed_seconds: 5 }))
      .rejects.toMatchObject({ code: '428C9' });
  });

  it('is keyed on (vehicle_id, work_date), so a rebuild replaces rather than duplicates', async () => {
    await insert(db);
    await expect(insert(db)).rejects.toMatchObject({ code: '23505' });
    await db.query(
      `INSERT INTO fleet_vehicle_daily_stats (vehicle_id, work_date, distance_km,
         coverage_granularity, coverage_ignition, coverage_gforce, coverage_provider_events, coverage_complete)
       VALUES ($1, $2, 99, 'history', false, false, false, false)
       ON CONFLICT (vehicle_id, work_date) DO UPDATE SET distance_km = EXCLUDED.distance_km`,
      [VEHICLE, WORK_DATE],
    );
    const { rows } = await db.query('SELECT distance_km FROM fleet_vehicle_daily_stats');
    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as { distance_km: string }).distance_km)).toBe(99);
  });

  it('disappears with its vehicle', async () => {
    await insert(db);
    await db.query('DELETE FROM fleet_vehicles WHERE id = $1', [VEHICLE]);
    const { rows } = await db.query('SELECT 1 FROM fleet_vehicle_daily_stats');
    expect(rows).toHaveLength(0);
    await db.query('INSERT INTO fleet_vehicles (id, registration) VALUES ($1, $2)', [VEHICLE, 'MIG528GP']);
  });
});

describe('every CHECK, driven to a rejection', () => {
  it('refuses a negative in any counter', async () => {
    for (const column of [
      'ignition_seconds', 'moving_seconds', 'idle_seconds', 'distance_km', 'max_speed_kph',
      'speeding_events', 'speeding_seconds', 'harsh_brake_events', 'harsh_accel_events',
      'harsh_corner_events', 'position_count', 'tracker_silence_seconds',
    ]) {
      // The zero baseline comes FIRST: spread order decides, and writing the override first let
      // the baseline silently overwrite it for the three time columns -- so three of the twelve
      // columns in this list were never actually tested until the run said so.
      await expectRejected({ ignition_seconds: 0, moving_seconds: 0, idle_seconds: 0, [column]: -1 });
    }
  });

  it('refuses moving + idle exceeding ignition — the double-counted interval', async () => {
    await expectRejected({ ignition_seconds: 100, moving_seconds: 60, idle_seconds: 60 });
    await expect(insert(db, { ignition_seconds: 120, moving_seconds: 60, idle_seconds: 60 }))
      .resolves.toBeTruthy();
  });

  it('refuses a last ignition earlier than the first, and one instant without the other', async () => {
    await expectRejected({
      first_ignition_at: '2026-08-10T17:00:00+02:00',
      last_ignition_at: '2026-08-10T06:00:00+02:00',
    });
    await expectRejected({ last_ignition_at: null });
    await expectRejected({ first_ignition_at: null });
    await expect(insert(db, { first_ignition_at: null, last_ignition_at: null }))
      .resolves.toBeTruthy();
  });

  it('refuses a coverage_granularity outside the closed set the TypeScript union names', async () => {
    await expectRejected({ coverage_granularity: 'partial' });
    for (const [i, granularity] of COVERAGE_GRANULARITIES.entries()) {
      await expect(insert(db, { work_date: `2026-09-0${i + 1}`, coverage_granularity: granularity }))
        .resolves.toBeTruthy();
    }
  });

  it('refuses a harsh count from a vehicle-day that could observe neither g nor provider events', async () => {
    // The six-of-seven firmware family with the events column empty: nothing may reach these
    // counters, or the constraint is satisfied by a fabrication.
    await expectRejected({
      coverage_gforce: false, coverage_provider_events: false, harsh_brake_events: 1,
      harsh_accel_events: 0, harsh_corner_events: 0,
    });
    await expectRejected({
      coverage_gforce: false, coverage_provider_events: false, harsh_brake_events: 0,
      harsh_accel_events: 0, harsh_corner_events: 2,
    });
    // Either evidence base on its own admits a count.
    await expect(insert(db, {
      work_date: '2026-09-20', coverage_gforce: true, coverage_provider_events: false,
    })).resolves.toBeTruthy();
    await expect(insert(db, {
      work_date: '2026-09-21', coverage_gforce: false, coverage_provider_events: true,
    })).resolves.toBeTruthy();
    // And zero counts are always storable.
    await expect(insert(db, {
      work_date: '2026-09-22', coverage_gforce: false, coverage_provider_events: false,
      harsh_brake_events: 0, harsh_accel_events: 0, harsh_corner_events: 0,
    })).resolves.toBeTruthy();
  });

  it('refuses ignition or idle seconds from a feed that does not assert ignition', async () => {
    await expectRejected({
      coverage_ignition: false, ignition_seconds: 3_600, moving_seconds: 0, idle_seconds: 0,
    });
    await expectRejected({
      coverage_ignition: false, ignition_seconds: 0, moving_seconds: 0, idle_seconds: 60,
    });
    // Distance and max speed stay allowed: those come from the odometer and the speed field,
    // which snapshot feeds do supply.
    await expect(insert(db, {
      work_date: '2026-09-25', coverage_ignition: false,
      ignition_seconds: 0, moving_seconds: 0, idle_seconds: 0,
      distance_km: 180.4, max_speed_kph: 121,
    })).resolves.toBeTruthy();
  });

  it('refuses a row that folded fixes without recording which fix it folded last', async () => {
    await expectRejected({ position_count: 10, source_watermark: null });
    await expect(insert(db, {
      work_date: '2026-09-26', position_count: 0, source_watermark: null,
    })).resolves.toBeTruthy();
  });

  it('refuses a negative positions_processed on the watermark', async () => {
    await expect(db.query(
      'INSERT INTO fleet_daily_stats_watermarks (vehicle_id, positions_processed) VALUES ($1, -1)',
      [VEHICLE],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      'INSERT INTO fleet_daily_stats_watermarks (vehicle_id, positions_processed) VALUES ($1, 4)',
      [VEHICLE],
    )).resolves.toBeTruthy();
  });
});

describe('what the application role may do', () => {
  /**
   * SET ROLE, because the owner connection above would pass with no GRANT at all. This is the
   * only assertion in the file that says anything about production, where the build service
   * connects as fibreflow_user and a missing GRANT is a 42501 on every run.
   */
  it('can select, insert, update and delete both tables', async () => {
    await expect(insert(appRole, { work_date: '2026-10-01' })).resolves.toBeTruthy();
    await expect(appRole.query(
      'UPDATE fleet_vehicle_daily_stats SET distance_km = 1 WHERE work_date = $1', ['2026-10-01'],
    )).resolves.toBeTruthy();
    await expect(appRole.query('SELECT 1 FROM fleet_vehicle_daily_stats')).resolves.toBeTruthy();
    await expect(appRole.query(
      'DELETE FROM fleet_vehicle_daily_stats WHERE work_date = $1', ['2026-10-01'],
    )).resolves.toBeTruthy();

    await expect(appRole.query(
      'INSERT INTO fleet_daily_stats_watermarks (vehicle_id, positions_processed) VALUES ($1, 7)',
      [VEHICLE],
    )).resolves.toBeTruthy();
    await expect(appRole.query('DELETE FROM fleet_daily_stats_watermarks')).resolves.toBeTruthy();
  });

  it('can write the new position column', async () => {
    await expect(appRole.query(
      `INSERT INTO fleet_vehicle_positions
         (vehicle_id, provider, account_ref, recorded_at, lat, lon, provider_event_type)
       VALUES ($1, 'cartrack', 'velocity', now(), -26.2041, 28.0473, 'IDLING_START')`, [VEHICLE],
    )).resolves.toBeTruthy();
  });
});

describe('rollback', () => {
  it('removes both tables and the column, leaving the position stream intact', async () => {
    await db.query(
      `INSERT INTO fleet_vehicle_positions (vehicle_id, provider, account_ref, recorded_at, lat, lon)
       VALUES ($1, 'cartrack', 'velocity', now(), -26.2041, 28.0473)`, [VEHICLE],
    );
    await db.query(ROLLBACK);

    const { rows: tables } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name IN
          ('fleet_vehicle_daily_stats', 'fleet_daily_stats_watermarks')`, [SCHEMA],
    );
    expect(tables).toEqual([]);

    const { rows: columns } = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'fleet_vehicle_positions'
          AND column_name = 'provider_event_type'`, [SCHEMA],
    );
    expect(columns).toEqual([]);

    const { rows: positions } = await db.query('SELECT 1 FROM fleet_vehicle_positions');
    expect(positions).toHaveLength(1);
  });

  it('is repeatable', async () => {
    await db.query(ROLLBACK);
    await expect(db.query(ROLLBACK)).resolves.toBeTruthy();
  });
});

if (!process.env.TEST_DATABASE_URL) throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const schema = 'mig489_fleet_status_geometry_scratch';
const baseUrl = process.env.TEST_DATABASE_URL;
const scopedUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
const admin = new Pool({ connectionString: baseUrl, ssl: false, max: 1 });
const db = new Pool({ connectionString: scopedUrl, ssl: false, max: 1 });

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query('CREATE TABLE test_sites (id text primary key, geom geometry(Polygon,4326))');
  await db.query(`INSERT INTO test_sites VALUES ('aoi', ST_GeomFromText('POLYGON((28 -26,28.01 -26,28.01 -26.01,28 -26.01,28 -26))',4326))`);
});
afterAll(async () => { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

describe('operational AOI geometry contract', () => {
  it.each([
    ['inside', 28.005, -26.005, true],
    ['boundary', 28, -26.005, true],
    ['outside', 28.02, -26.005, false],
  ])('uses ST_Covers for %s points and returns geography distance in metres', async (_label, longitude, latitude, expectedInside) => {
    const { rows } = await db.query<{ inside: boolean; distance_m: number }>(`
      SELECT ST_Covers(geom, point) AS inside,
        ST_Distance(geom::geography, point::geography) AS distance_m
      FROM test_sites CROSS JOIN LATERAL ST_SetSRID(ST_Point($1,$2),4326) point`, [longitude, latitude]);
    expect(rows[0]!.inside).toBe(expectedInside);
    const distanceM = Number(rows[0]!.distance_m);
    if (expectedInside) expect(distanceM).toBeCloseTo(0, 6);
    else {
      expect(distanceM).toBeGreaterThan(900);
      expect(distanceM).toBeLessThan(1100);
    }
  });
});

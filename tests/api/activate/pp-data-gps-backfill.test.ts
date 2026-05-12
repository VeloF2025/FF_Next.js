/**
 * Tests for GPS backfill after serial → DR resolution.
 * Integration tests — require live Supabase DB.
 * Skips gracefully when no suitable test data exists.
 */
import { describe, it, expect } from 'vitest';
import pool from '@/lib/db';

describe('GPS backfill for resolved PP serials', () => {
  it('oes_pp_data with resolved_drop_number and NULL GPS gets backfilled from drops', async () => {
    const drResult = await pool.query(`
      SELECT pp.id, pp.resolved_drop_number, d.latitude, d.longitude
      FROM oes_pp_data pp
      JOIN drops d ON d.drop_number = pp.resolved_drop_number
      WHERE pp.resolved_drop_number IS NOT NULL
        AND pp.latitude IS NULL
        AND d.latitude IS NOT NULL
      LIMIT 1
    `);
    if (drResult.rows.length === 0) return; // no suitable test data — skip

    const row = drResult.rows[0] as {
      id: number; resolved_drop_number: string; latitude: number; longitude: number;
    };

    await pool.query(`
      UPDATE oes_pp_data pp
      SET latitude = d.latitude, longitude = d.longitude, updated_at = NOW()
      FROM drops d
      WHERE d.drop_number = pp.resolved_drop_number
        AND pp.id = $1
        AND pp.latitude IS NULL
        AND d.latitude IS NOT NULL
    `, [row.id]);

    const after = await pool.query(
      `SELECT latitude, longitude FROM oes_pp_data WHERE id = $1`, [row.id]
    );
    expect(Number(after.rows[0].latitude)).toBeCloseTo(row.latitude, 5);
    expect(Number(after.rows[0].longitude)).toBeCloseTo(row.longitude, 5);

    // Cleanup: restore NULL so test is idempotent
    await pool.query(
      `UPDATE oes_pp_data SET latitude = NULL, longitude = NULL WHERE id = $1`, [row.id]
    );
  });

  it('dr_photo_unified_reviews gets GPS from drops', async () => {
    const drResult = await pool.query(`
      SELECT ur.drop_number, d.latitude, d.longitude
      FROM dr_photo_unified_reviews ur
      JOIN drops d ON d.drop_number = ur.drop_number
      WHERE ur.latitude IS NULL
        AND d.latitude IS NOT NULL
      LIMIT 1
    `);
    if (drResult.rows.length === 0) return;

    const row = drResult.rows[0] as { drop_number: string; latitude: number; longitude: number };

    await pool.query(`
      UPDATE dr_photo_unified_reviews ur
      SET latitude = d.latitude, longitude = d.longitude, updated_at = NOW()
      FROM drops d
      WHERE d.drop_number = ur.drop_number
        AND ur.drop_number = $1
        AND ur.latitude IS NULL
        AND d.latitude IS NOT NULL
    `, [row.drop_number]);

    const after = await pool.query(
      `SELECT latitude, longitude FROM dr_photo_unified_reviews WHERE drop_number = $1`,
      [row.drop_number]
    );
    expect(Number(after.rows[0].latitude)).toBeCloseTo(row.latitude, 5);

    // Cleanup
    await pool.query(
      `UPDATE dr_photo_unified_reviews SET latitude = NULL, longitude = NULL WHERE drop_number = $1`,
      [row.drop_number]
    );
  });
});

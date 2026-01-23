/**
 * API Route: /api/activate/check-oes-coordinates
 *
 * Diagnostic endpoint to check OES coordinate data
 * Method: GET
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';


// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Total records
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM oes_activations');
    const total = parseInt(totalResult.rows[0].total);

    // 2. Coordinate statistics
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as has_latitude,
        COUNT(CASE WHEN longitude IS NOT NULL THEN 1 END) as has_longitude,
        COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as has_both,
        COUNT(CASE WHEN latitude != 0 AND longitude != 0 THEN 1 END) as non_zero_coords,
        COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 THEN 1 END) as valid_coords
      FROM oes_activations
    `);
    const stats = statsResult.rows[0];

    // 3. Sample records
    const sampleResult = await pool.query(`
      SELECT
        drop_number,
        latitude,
        longitude,
        activation_date,
        team,
        status,
        created_at
      FROM oes_activations
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // 4. Today's imports
    const todayResult = await pool.query(`
      SELECT
        drop_number,
        latitude,
        longitude,
        team,
        status,
        created_at
      FROM oes_activations
      WHERE DATE(created_at) = CURRENT_DATE
      LIMIT 10
    `);

    // 5. Coordinate ranges
    const rangeResult = await pool.query(`
      SELECT
        MIN(latitude) as min_lat,
        MAX(latitude) as max_lat,
        AVG(latitude) as avg_lat,
        MIN(longitude) as min_lon,
        MAX(longitude) as max_lon,
        AVG(longitude) as avg_lon
      FROM oes_activations
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);

    return res.status(200).json({
      summary: {
        total_records: total,
        has_latitude: parseInt(stats.has_latitude),
        has_longitude: parseInt(stats.has_longitude),
        has_both_coords: parseInt(stats.has_both),
        non_zero_coords: parseInt(stats.non_zero_coords),
        valid_coords: parseInt(stats.valid_coords),
        missing_coords: total - parseInt(stats.valid_coords)
      },
      coordinate_ranges: rangeResult.rows[0],
      sample_records: sampleResult.rows,
      todays_imports: todayResult.rows,
      diagnostic: {
        expected_valid: 6682, // from Excel
        actual_valid: parseInt(stats.valid_coords),
        difference: 6682 - parseInt(stats.valid_coords),
        percentage_valid: total > 0 ? ((parseInt(stats.valid_coords) / total) * 100).toFixed(2) + '%' : '0%'
      }
    });

  } catch (error) {
    console.error('Check OES coordinates error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to check OES coordinates'
    });
  }
}
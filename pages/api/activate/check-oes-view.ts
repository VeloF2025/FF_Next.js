/**
 * API Route: /api/activate/check-oes-view
 *
 * Check if the v_qfield_oes_activations view exists and has data
 * Method: GET
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';


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

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if view exists
    const viewResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.views
        WHERE table_schema = 'public'
        AND table_name = 'v_qfield_oes_activations'
      ) as view_exists
    `);

    const viewExists = viewResult.rows[0].view_exists;

    let viewData = null;
    let viewCount = 0;
    let viewDefinition = null;

    if (viewExists) {
      // Get view row count
      try {
        const countResult = await pool.query(`
          SELECT COUNT(*) as count FROM v_qfield_oes_activations
        `);
        viewCount = parseInt(countResult.rows[0].count);

        // Get sample data
        const sampleResult = await pool.query(`
          SELECT * FROM v_qfield_oes_activations LIMIT 5
        `);
        viewData = sampleResult.rows;

        // Get view definition
        const defResult = await pool.query(`
          SELECT view_definition
          FROM information_schema.views
          WHERE table_schema = 'public'
          AND table_name = 'v_qfield_oes_activations'
        `);
        viewDefinition = defResult.rows[0]?.view_definition;
      } catch (e) {
        console.error('Error querying view:', e);
      }
    }

    // Create view SQL if it doesn't exist
    const createViewSQL = `
CREATE OR REPLACE VIEW v_qfield_oes_activations AS
SELECT
  oes.drop_number,
  oes.activation_date,
  oes.serial_number,
  oes.latitude,
  oes.longitude,
  d.zone,
  d.pon,
  d.project AS project_name,
  oes.ont_rx_sig_dbm,
  oes.status,
  oes.updated_at,
  oes.team
FROM oes_activations oes
LEFT JOIN drops d ON oes.drop_number = d.drop_number
WHERE oes.latitude IS NOT NULL
  AND oes.longitude IS NOT NULL
  AND oes.latitude != 0
  AND oes.longitude != 0;`;

    return res.status(200).json({
      view_exists: viewExists,
      view_count: viewCount,
      view_sample: viewData,
      view_definition: viewDefinition,
      recommendation: !viewExists ? 'View does not exist. Create it using the SQL below.' :
                      viewCount === 0 ? 'View exists but has no data. Check join conditions.' :
                      'View exists and has data. Sync should work.',
      create_view_sql: !viewExists ? createViewSQL : null,
      oes_table_count: await pool.query('SELECT COUNT(*) FROM oes_activations').then(r => r.rows[0].count),
      drops_table_count: await pool.query('SELECT COUNT(*) FROM drops').then(r => r.rows[0].count)
    });

  } catch (error) {
    console.error('Check OES view error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to check OES view'
    });
  }
}
export default withAuth(handler);

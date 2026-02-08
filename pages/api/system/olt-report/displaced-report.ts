/**
 * Displaced ONT Report API
 *
 * GET: Returns all displaced ONT records from serial_change_history
 *      with activation status from backfilled metadata.
 *
 * Query params:
 * - filter: 'all' | 'unactivated' | 'activated' (default: 'all')
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const filter = (req.query.filter as string) || 'all';

  const client = await pool.connect();
  try {
    // Build WHERE clause for filter
    let filterClause = '';
    if (filter === 'unactivated') {
      filterClause = "AND (metadata->>'displaced_activated')::boolean = false";
    } else if (filter === 'activated') {
      filterClause = "AND (metadata->>'displaced_activated')::boolean = true";
    }

    const result = await client.query(`
      SELECT drop_number, old_value, new_value, created_at,
             metadata->>'displaced_serial' as displaced_serial,
             (metadata->>'displaced_activated')::boolean as displaced_activated,
             metadata->>'displaced_owner_dr' as displaced_owner_dr,
             metadata->>'displaced_owner_team' as displaced_owner_team
      FROM serial_change_history
      WHERE change_type = 'ont_serial'
        AND metadata->>'displaced_serial' IS NOT NULL
        ${filterClause}
      ORDER BY created_at DESC
      LIMIT 500
    `);

    // Get summary counts
    const counts = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE (metadata->>'displaced_activated')::boolean = false) as unactivated,
        COUNT(*) FILTER (WHERE (metadata->>'displaced_activated')::boolean = true) as activated
      FROM serial_change_history
      WHERE change_type = 'ont_serial'
        AND metadata->>'displaced_serial' IS NOT NULL
    `);

    const summary = counts.rows[0];

    return apiResponse.success(res, {
      total: parseInt(summary.total),
      unactivated: parseInt(summary.unactivated),
      activated: parseInt(summary.activated),
      records: result.rows,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));

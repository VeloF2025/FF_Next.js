/**
 * Get Admin Users API
 *
 * GET: Returns list of admin users for escalation dropdown
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT id, email, first_name, last_name,
             COALESCE(first_name || ' ' || last_name, first_name, last_name, email) as display_name
      FROM users
      WHERE role = 'admin'
        AND is_active = true
      ORDER BY first_name ASC, last_name ASC, email ASC
    `);

    return apiResponse.success(res, {
      users: result.rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.display_name || u.email,
      })),
    });
  } catch (error) {
    log.error('OltReportAdminUsers', 'Failed to fetch admin users', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));

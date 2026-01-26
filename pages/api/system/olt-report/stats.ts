/**
 * OLT Report Stats API
 *
 * GET: Return counts by fix_status for OLT mismatch records
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

interface Stats {
  pending: number;
  needs_investigation: number;
  fixed: number;
  resolved: number;
  escalated: number;
  empty: number;
  total: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const result = await pool.query(`
      SELECT
        fix_status,
        COUNT(*)::int as count
      FROM olt_mismatch_records
      GROUP BY fix_status
    `);

    const stats: Stats = {
      pending: 0,
      needs_investigation: 0,
      fixed: 0,
      resolved: 0,
      escalated: 0,
      empty: 0,
      total: 0,
    };

    for (const row of result.rows) {
      const status = row.fix_status?.toLowerCase() || 'pending';
      const count = row.count;

      if (status === 'pending') stats.pending = count;
      else if (status === 'needs_investigation' || status === 'needs_reinvestigation') stats.needs_investigation += count;
      else if (status === 'fixed') stats.fixed = count;
      else if (status === 'resolved') stats.resolved = count;
      else if (status === 'escalated') stats.escalated = count;
      else if (status === 'empty_serial') stats.empty = count;

      stats.total += count;
    }

    return apiResponse.success(res, stats);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

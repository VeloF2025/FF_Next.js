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
    // Get counts with more nuanced grouping
    // "Pending/Fixable" = records with OLT serial that can be fixed
    // "Needs Investigation" = records without OLT serial or marked for investigation
    const result = await pool.query(`
      SELECT
        CASE
          WHEN fix_status IN ('pending', 'not_found') AND olt_serial IS NOT NULL THEN 'pending'
          WHEN fix_status IN ('needs_investigation', 'needs_reinvestigation', 'empty_serial') OR olt_serial IS NULL THEN 'needs_investigation'
          ELSE fix_status
        END as category,
        COUNT(*)::int as count
      FROM olt_mismatch_records
      GROUP BY category
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
      const category = row.category?.toLowerCase() || 'pending';
      const count = row.count;

      if (category === 'pending') stats.pending = count;
      else if (category === 'needs_investigation') stats.needs_investigation = count;
      else if (category === 'fixed') stats.fixed = count;
      else if (category === 'resolved') stats.resolved = count;
      else if (category === 'escalated') stats.escalated = count;
      else if (category === 'empty_serial') stats.empty = count;

      stats.total += count;
    }

    return apiResponse.success(res, stats);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

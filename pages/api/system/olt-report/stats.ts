/**
 * OLT Report Stats API
 *
 * GET: Return counts by fix_status for OLT mismatch records
 * Optional query params:
 * - dateFrom: ISO date string (filter records created/fixed after this date)
 * - dateTo: ISO date string (filter records created/fixed before this date)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

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
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;

    // Build date filter — uses created_at for pending/investigate, fix_attempted_at for fixed
    const params: string[] = [];
    let dateFilter = '';
    if (dateFrom) {
      params.push(dateFrom);
      dateFilter += ` AND COALESCE(fix_attempted_at, created_at) >= $${params.length}::timestamptz`;
    }
    if (dateTo) {
      params.push(dateTo);
      dateFilter += ` AND COALESCE(fix_attempted_at, created_at) < $${params.length}::timestamptz`;
    }

    const result = await pool.query(`
      SELECT
        CASE
          WHEN fix_status = 'pending' AND olt_serial IS NOT NULL THEN 'pending'
          WHEN fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial') OR olt_serial IS NULL THEN 'needs_investigation'
          ELSE fix_status
        END as category,
        COUNT(*)::int as count
      FROM olt_mismatch_records
      WHERE 1=1 ${dateFilter}
      GROUP BY category
    `, params);

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

    // Investigate sub-counts (breakdown of needs_investigation group)
    const subResult = await pool.query(`
      SELECT
        CASE
          WHEN fix_status IN ('needs_investigation', 'needs_reinvestigation') THEN 'cross_dr'
          WHEN fix_status = 'not_found' THEN 'not_found'
          ELSE 'other'
        END as sub_category,
        COUNT(*)::int as count
      FROM olt_mismatch_records
      WHERE (fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial') OR olt_serial IS NULL)
        ${dateFilter}
      GROUP BY sub_category
    `, params);

    const investigateBreakdown: Record<string, number> = { cross_dr: 0, not_found: 0, other: 0 };
    for (const row of subResult.rows) {
      investigateBreakdown[row.sub_category] = row.count;
    }

    return apiResponse.success(res, { ...stats, investigateBreakdown });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

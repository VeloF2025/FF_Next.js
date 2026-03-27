/**
 * GET /api/billing/dr-history
 *
 * DR deduction lifecycle view. Shows all unique DRs ever deducted,
 * whether they're currently excluded or recovered, how many weeks
 * they were deducted, and their internal status.
 *
 * Query params:
 *   project  - required: Lawley | Mohadin | Mamelodi
 *   status   - optional: 'excluded' | 'recovered' | 'all' (default: 'all')
 *   note     - optional: note1..note5 filter
 *   search   - optional: DR number search
 *   limit    - optional: default 100
 *   offset   - optional: default 0
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/billing/dr-history');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const project = typeof req.query.project === 'string' ? req.query.project.trim() : null;
    if (!project) return apiResponse.badRequest(res, 'project is required');

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const noteFilter = typeof req.query.note === 'string' ? req.query.note : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    const offset = parseInt(String(req.query.offset || '0'), 10) || 0;

    // Get latest billing week for this project
    const latestWeekResult = await pool.query(
      `SELECT id FROM ft_weekly_billing WHERE project ILIKE $1 ORDER BY week_ending DESC LIMIT 1`,
      [project]
    );
    const latestWeekId = latestWeekResult.rows[0]?.id;

    if (!latestWeekId) {
      return apiResponse.success(res, { rows: [], total: 0, latestWeekId: null });
    }

    // Build the query
    const params: (string | number)[] = [project, latestWeekId];
    const conditions: string[] = [];

    if (noteFilter && /^note[1-5]$/.test(noteFilter)) {
      params.push(noteFilter);
      conditions.push(`$${params.length} = ANY(ad.note_types)`);
    }

    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      conditions.push(`ad.dr_number LIKE $${params.length}`);
    }

    if (statusFilter === 'excluded') {
      conditions.push(`ce.dr_number IS NOT NULL`);
    } else if (statusFilter === 'recovered') {
      conditions.push(`ce.dr_number IS NULL`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    params.push(limit, offset);

    const result = await pool.query(`
      WITH latest_excluded AS (
        SELECT DISTINCT dr_number
        FROM ft_billing_deductions
        WHERE billing_week_id = $2
      ),
      all_deducted AS (
        SELECT
          d.dr_number,
          d.project,
          MIN(d.week_ending)::text AS first_excluded,
          MAX(d.week_ending)::text AS last_excluded,
          COUNT(DISTINCT d.billing_week_id)::int AS weeks_excluded,
          array_agg(DISTINCT d.deduction_note ORDER BY d.deduction_note) AS note_types
        FROM ft_billing_deductions d
        WHERE d.project ILIKE $1
        GROUP BY d.dr_number, d.project
      )
      SELECT
        ad.dr_number,
        ad.project,
        ad.first_excluded,
        ad.last_excluded,
        ad.weeks_excluded,
        ad.note_types,
        CASE WHEN ce.dr_number IS NOT NULL THEN 'excluded' ELSE 'recovered' END AS current_status,
        oa.activation_date::text AS activation_date,
        oa.status AS oes_status,
        oa.ont_rx_sig_dbm AS signal_dbm,
        CASE WHEN dr.id IS NOT NULL THEN true ELSE false END AS has_dr_record,
        dr.human_review_status AS dr_review_status
      FROM all_deducted ad
      LEFT JOIN latest_excluded ce ON ce.dr_number = ad.dr_number
      LEFT JOIN oes_activations oa ON oa.drop_number = ad.dr_number
      LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = ad.dr_number
      ${whereClause}
      ORDER BY
        CASE WHEN ce.dr_number IS NOT NULL THEN 0 ELSE 1 END,
        ad.weeks_excluded DESC,
        ad.dr_number
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Get total count
    const countParams = params.slice(0, -2); // remove limit/offset
    const countResult = await pool.query(`
      WITH latest_excluded AS (
        SELECT DISTINCT dr_number
        FROM ft_billing_deductions
        WHERE billing_week_id = $2
      ),
      all_deducted AS (
        SELECT
          d.dr_number,
          d.project,
          COUNT(DISTINCT d.billing_week_id)::int AS weeks_excluded,
          array_agg(DISTINCT d.deduction_note ORDER BY d.deduction_note) AS note_types
        FROM ft_billing_deductions d
        WHERE d.project ILIKE $1
        GROUP BY d.dr_number, d.project
      )
      SELECT COUNT(*)::int AS total
      FROM all_deducted ad
      LEFT JOIN latest_excluded ce ON ce.dr_number = ad.dr_number
      ${whereClause}
    `, countParams);

    // Summary stats
    const summaryResult = await pool.query(`
      WITH latest_excluded AS (
        SELECT DISTINCT dr_number FROM ft_billing_deductions WHERE billing_week_id = $2
      ),
      all_deducted AS (
        SELECT d.dr_number, d.project
        FROM ft_billing_deductions d WHERE d.project ILIKE $1
        GROUP BY d.dr_number, d.project
      )
      SELECT
        COUNT(*)::int AS total_unique,
        COUNT(CASE WHEN ce.dr_number IS NOT NULL THEN 1 END)::int AS still_excluded,
        COUNT(CASE WHEN ce.dr_number IS NULL THEN 1 END)::int AS recovered
      FROM all_deducted ad
      LEFT JOIN latest_excluded ce ON ce.dr_number = ad.dr_number
    `, [project, latestWeekId]);

    logger.info('DR history fetched', {
      project,
      statusFilter,
      total: countResult.rows[0]?.total || 0,
    });

    return apiResponse.success(res, {
      rows: result.rows,
      total: countResult.rows[0]?.total || 0,
      summary: summaryResult.rows[0] || { total_unique: 0, still_excluded: 0, recovered: 0 },
      latestWeekId,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch DR history';
    logger.error('dr-history failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler);

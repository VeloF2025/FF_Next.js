/**
 * GET /api/tracker/dashboard
 * Cross-project aggregate KPIs from pon_stage_tracking.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { rows } = await pool.query(
      `SELECT
         pr.id           AS project_id,
         pr.project_name,
         COUNT(p.id)::int                                             AS total_pons,
         COALESCE(SUM(p.permissions_approved), 0)::int                AS permissions_approved,
         COALESCE(SUM(p.permissions_total), 0)::int                   AS permissions_total,
         COALESCE(SUM(p.poles_planted), 0)::int                       AS poles_planted,
         COALESCE(SUM(p.poles_total), 0)::int                         AS poles_total,
         COALESCE(SUM(p.cwc_complete), 0)::int                        AS cwc_complete,
         COALESCE(SUM(p.cwc_total), 0)::int                           AS cwc_total,
         COALESCE(SUM(p.optical_complete), 0)::int                    AS optical_complete,
         COALESCE(SUM(p.optical_total), 0)::int                       AS optical_total,
         COALESCE(SUM(p.atp_passed), 0)::int                          AS atp_passed,
         COALESCE(SUM(p.atp_total), 0)::int                           AS atp_total,
         COALESCE(SUM(p.activation_complete), 0)::int                 AS activation_complete,
         COALESCE(SUM(p.activation_total), 0)::int                    AS activation_total,
         COUNT(CASE WHEN p.overall_stage = 'complete' THEN 1 END)::int AS pons_complete,
         COALESCE(SUM(p.sign_ups), 0)::int                            AS sign_ups,
         COALESCE(SUM(p.homes_po), 0)::int                            AS homes_po,
         MAX(p.last_synced_at)                                         AS last_synced_at
       FROM projects pr
       LEFT JOIN pon_stage_tracking p ON p.project_id = pr.id
       WHERE pr.status = 'active'
       GROUP BY pr.id, pr.project_name
       ORDER BY pr.project_name`
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    log.error('[tracker/dashboard GET]', { err: String(err) });
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}

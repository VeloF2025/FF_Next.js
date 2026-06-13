/**
 * FT expected-recovery audit read (audit rec #2).
 *
 * GET: summary counts (pending / recovered / not_returned + avg acceptance lag) and
 * paginated rows from ft_billing_expected_recovery (migration 415). The actionable
 * not_returned items also surface in the Action Centre Candidates view via their
 * verdict='disputable' mark; this endpoint is the recovery audit trail + metric.
 *
 * Query params:
 * - status: pending | recovered | not_returned (anything else = no filter)
 * - project: exact project match
 * - page / pageSize (default 50, max 200)
 *
 * Read-only. Status: WORKING | NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const STATUSES = ['pending', 'recovered', 'not_returned'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10) || 50));
    const offset = (page - 1) * pageSize;

    const status = req.query.status ? String(req.query.status) : null;
    const project = req.query.project ? String(req.query.project).trim() : null;

    // whereClause carries only bound placeholder references ("status = $n",
    // "project = $n"); every user value goes into params[], never into the SQL string.
    const conditions: string[] = [];
    const params: string[] = [];
    if (status && (STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (project) {
      params.push(project);
      conditions.push(`project = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Summary is global (unaffected by the row filter) so the cards are stable.
    const summaryRes = await pool.query(
      `SELECT status, COUNT(*)::int AS count,
              ROUND(AVG(recovery_lag_days) FILTER (WHERE status='recovered'))::int AS avg_lag_days
         FROM ft_billing_expected_recovery
        GROUP BY status`,
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ft_billing_expected_recovery ${whereClause}`,
      params,
    );
    const total = countRes.rows[0]?.total || 0;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rowsRes = await pool.query(
      `SELECT drop_number, project, deduction_note, deduction_week_ending,
              fix_signal, fix_at, status, detected_week_ending, confirmed_week_ending,
              recovery_lag_days, dispute_deduction_id, evidence, updated_at
         FROM ft_billing_expected_recovery
         ${whereClause}
         ORDER BY updated_at DESC, drop_number
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, pageSize, offset],
    );

    return apiResponse.success(res, {
      summary: summaryRes.rows,
      records: rowsRes.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    log.error('billing-expected-recoveries', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

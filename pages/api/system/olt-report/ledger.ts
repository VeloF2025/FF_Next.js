/**
 * Per-DR three-way reconciliation ledger API (audit rec #3).
 *
 * GET: paginated rows from v_dr_reconciliation_ledger (migration 414) — the WA /
 * OES / 1Map / drops serials, lifecycle, payment + the recon_class three-way
 * conflict classification, one row per DR.
 *
 * Query params:
 * - recon_class: one of serial_other_dr | wa_no_oes | oes_no_1map |
 *     deducted_but_active | all_agree | no_evidence (anything else = no filter)
 * - project: exact project match
 * - search: ILIKE on drop_number or any of the four serials
 * - page: page number (default 1)
 * - pageSize: rows per page (default 50, max 200)
 * - summary: '1' to also return per-class counts (unfiltered) for the tab cards
 *
 * Read-only. Status: WORKING | NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildLedgerQuery, LEDGER_COLUMNS } from '@/modules/data-sync/services/reconLedgerQuery';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { whereClause, params, page, pageSize, offset } = buildLedgerQuery(req.query);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM v_dr_reconciliation_ledger ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const result = await pool.query(
      `SELECT ${LEDGER_COLUMNS}
       FROM v_dr_reconciliation_ledger
       ${whereClause}
       ORDER BY COALESCE(oes_activated_at, wa_submitted_at) DESC NULLS LAST, drop_number
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, pageSize, offset]
    );

    let summary: Array<{ recon_class: string; count: number }> | undefined;
    if (req.query.summary === '1') {
      const summaryResult = await pool.query(
        `SELECT recon_class, COUNT(*)::int AS count
         FROM v_dr_reconciliation_ledger
         GROUP BY recon_class`
      );
      summary = summaryResult.rows;
    }

    return apiResponse.success(res, {
      records: result.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      ...(summary ? { summary } : {}),
    });
  } catch (error) {
    log.error('olt-report-ledger', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

/**
 * GET  /api/billing/reconcile?id=<uuid>  — Return billing week row + deductions
 * POST /api/billing/reconcile { id }     — Run reconciliation: compute our OES
 *   counts vs FT counts, update variance, mark oes_activations payment_status.
 * CRITICAL: deductions are cumulative snapshots — never sum across weeks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/billing/reconcile');

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingWeekRow {
  id: string;
  week_ending: string;
  project: string;
  ft_total_claimable: number;
  ft_note1_count: number;
  ft_note2_count: number;
  ft_note3_count: number;
  ft_note4_count: number;
  ft_note5_count: number;
  ft_pre_provisions_count: number;
  reconciliation_status: string;
}

interface DeductionRow {
  id: string;
  dr_number: string;
  deduction_note: string;
  serial_number: string | null;
  team: string | null;
  deduction_reason: string | null;
}

// ─── GET Handler ──────────────────────────────────────────────────────────────

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'id query parameter is required');
  }

  const weekResult = await pool.query<BillingWeekRow>(
    `SELECT * FROM ft_weekly_billing WHERE id = $1`,
    [id]
  );

  if (weekResult.rows.length === 0) {
    return apiResponse.notFound(res, 'Billing week', id);
  }

  const deductionResult = await pool.query(
    `SELECT
       d.id, d.dr_number, d.deduction_note, d.serial_number, d.team, d.deduction_reason,
       CASE WHEN oa.id IS NOT NULL THEN oa.status ELSE NULL END AS oes_status,
       oa.activation_date AS oes_activation_date,
       oa.ont_rx_sig_dbm AS oes_signal_dbm,
       CASE WHEN dr.id IS NOT NULL THEN true ELSE false END AS has_dr_record,
       dr.human_review_status AS dr_review_status,
       olt.fix_status AS olt_fix_status,
       pp.resolution_status AS pp_status
     FROM ft_billing_deductions d
     LEFT JOIN oes_activations oa ON oa.drop_number = d.dr_number
     LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = d.dr_number
     LEFT JOIN olt_mismatch_records olt ON olt.drop_number = d.dr_number
     LEFT JOIN oes_pp_data pp ON pp.serial_number = d.serial_number AND pp.project = d.project
     WHERE d.billing_week_id = $1
     ORDER BY d.deduction_note, d.dr_number`,
    [id]
  );

  return apiResponse.success(res, {
    week: weekResult.rows[0],
    deductions: deductionResult.rows,
  });
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

async function handlePost(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { id } = req.body as { id?: string };

  if (!id) {
    return apiResponse.badRequest(res, 'id is required in request body');
  }

  // ── Load the billing week ───────────────────────────────────────────────
  const weekResult = await pool.query<BillingWeekRow>(
    `SELECT * FROM ft_weekly_billing WHERE id = $1`,
    [id]
  );

  if (weekResult.rows.length === 0) {
    return apiResponse.notFound(res, 'Billing week', id);
  }

  const week = weekResult.rows[0]!;
  const { project, week_ending } = week;

  logger.info('Running reconciliation', { id, project, week_ending });

  // ── Load deductions for this week ───────────────────────────────────────
  const deductionResult = await pool.query<{
    dr_number: string;
    deduction_note: string;
  }>(
    `SELECT dr_number, deduction_note FROM ft_billing_deductions WHERE billing_week_id = $1`,
    [id]
  );
  const deductedDRs = deductionResult.rows;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Count cumulative OES activations up to week_ending ─────────────
    const activationResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM oes_activations oa
       JOIN drops d ON d.id = oa.drop_id
       JOIN projects p ON p.id = d.project_id
       WHERE p.project_name ILIKE $1
         AND oa.activation_date <= $2`,
      [project, week_ending]
    );
    const ourTotalActivations = parseInt(activationResult.rows[0]?.count ?? '0', 10);

    // ── 2. Sum previously invoiced (ft_total_claimable from prior weeks) ──
    const prevInvoicedResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(ft_total_claimable), 0) AS total
       FROM ft_weekly_billing
       WHERE project ILIKE $1
         AND week_ending < $2`,
      [project, week_ending]
    );
    const previouslyInvoiced = parseInt(prevInvoicedResult.rows[0]?.total ?? '0', 10);

    // ── 3. our_claimable = total activations - previously invoiced ─────────
    const ourClaimable = ourTotalActivations - previouslyInvoiced;

    // ── 4. Count pre-provisions outstanding ───────────────────────────────
    const ppResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM oes_pp_data
       WHERE project ILIKE $1
         AND resolution_status != 'activated'`,
      [project]
    );
    const ourPreProvisionsCount = parseInt(ppResult.rows[0]?.count ?? '0', 10);

    // ── 5. Compute variance (our values - FT values) ───────────────────────
    const varianceClaimable = ourClaimable - (week.ft_total_claimable ?? 0);
    const varianceTotalOnts = null; // Total ONTs comparison requires our ONT count (future)

    // ── 6. Update ft_weekly_billing ────────────────────────────────────────
    const reconciledBy =
      (req as AuthenticatedNextApiRequest).user?.email ??
      (req as AuthenticatedNextApiRequest).user?.name ??
      'unknown';

    await client.query(
      `UPDATE ft_weekly_billing SET
         our_total_activations    = $1,
         our_claimable            = $2,
         our_pre_provisions_count = $3,
         variance_claimable       = $4,
         variance_total_onts      = $5,
         reconciliation_status    = 'reconciled',
         reconciled_at            = NOW(),
         reconciled_by            = $6,
         updated_at               = NOW()
       WHERE id = $7`,
      [
        ourTotalActivations,
        ourClaimable,
        ourPreProvisionsCount,
        varianceClaimable,
        varianceTotalOnts,
        reconciledBy,
        id,
      ]
    );

    // ── 7. Mark deducted DRs on oes_activations ────────────────────────────
    let deductedCount = 0;
    for (const row of deductedDRs) {
      const updateResult = await client.query(
        `UPDATE oes_activations
         SET payment_status = 'deducted',
             payment_week   = $1,
             payment_note   = $2
         WHERE drop_number = $3
           AND (payment_status = 'not_yet_claimed' OR payment_status = 'deducted')`,
        [week_ending, row.deduction_note, row.dr_number]
      );
      deductedCount += updateResult.rowCount ?? 0;
    }

    // ── 8. Mark remaining newly claimable DRs as 'paid' ───────────────────
    // Get the previous week_ending for this project (to establish the date window)
    const prevWeekResult = await client.query<{ week_ending: string }>(
      `SELECT week_ending FROM ft_weekly_billing
       WHERE project ILIKE $1
         AND week_ending < $2
       ORDER BY week_ending DESC
       LIMIT 1`,
      [project, week_ending]
    );
    const prevWeekEnding = prevWeekResult.rows[0]?.week_ending ?? null;

    // Build the set of deducted DR numbers for exclusion
    const deductedDRNumbers = deductedDRs.map(d => d.dr_number);

    // Newly claimable = activated between (prevWeekEnding, weekEnding], not deducted
    const paidUpdateResult = await client.query(
      `UPDATE oes_activations oa
       SET payment_status = 'paid',
           payment_week   = $1
       FROM drops d
       JOIN projects p ON p.id = d.project_id
       WHERE oa.drop_id = d.id
         AND p.project_name ILIKE $2
         AND oa.activation_date <= $3
         AND ($4::date IS NULL OR oa.activation_date > $4::date)
         AND oa.payment_status = 'not_yet_claimed'
         AND (
           $5::varchar[] IS NULL
           OR array_length($5::varchar[], 1) = 0
           OR oa.drop_number != ALL($5::varchar[])
         )`,
      [
        week_ending,
        project,
        week_ending,
        prevWeekEnding,
        deductedDRNumbers.length > 0 ? deductedDRNumbers : null,
      ]
    );
    const paidCount = paidUpdateResult.rowCount ?? 0;

    await client.query('COMMIT');

    logger.info('Reconciliation complete', {
      id,
      project,
      week_ending,
      ourTotalActivations,
      ourClaimable,
      previouslyInvoiced,
      varianceClaimable,
      deductedCount,
      paidCount,
    });

    // ── Return updated row ─────────────────────────────────────────────────
    const updatedResult = await pool.query(
      `SELECT * FROM ft_weekly_billing WHERE id = $1`,
      [id]
    );

    return apiResponse.success(res, {
      week: updatedResult.rows[0],
      reconciliation: {
        ourTotalActivations,
        ourClaimable,
        previouslyInvoiced,
        ourPreProvisionsCount,
        varianceClaimable,
        deductedCount,
        paidCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message =
      error instanceof Error ? error.message : 'Reconciliation failed';
    logger.error('reconcile POST failed', { id, error: message });
    return res.status(500).json({ success: false, error: message });
  } finally {
    client.release();
  }
}

// ─── Route Dispatcher ─────────────────────────────────────────────────────────

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(withRole('manager')(handler as any));

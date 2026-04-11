/**
 * Reconcile a single ft_weekly_billing row against our internal activation
 * tally. Extracted from pages/api/billing/reconcile.ts so both the HTTP
 * endpoint and the bundle importer (which upserts many rows at once) can
 * share the exact same logic.
 *
 * Flow, per billing week row:
 *   1. Count our cumulative OES activations up to week_ending for project
 *   2. Subtract everything we've already invoiced on earlier weeks
 *   3. Compute variance vs FT's claimable figure
 *   4. Count outstanding pre-provisions (oes_pp_data)
 *   5. UPDATE ft_weekly_billing: set our_* columns, variance_*, status
 *   6. Tag every deducted DR on oes_activations with payment_status='deducted'
 *
 * All steps run inside one transaction per billing week so a partial
 * failure rolls back cleanly.
 */

import type { PoolClient } from 'pg';

export interface ReconcileOutcome {
  billingWeekId: string;
  ourTotalActivations: number;
  ourClaimable: number;
  ourPreProvisionsCount: number;
  varianceClaimable: number;
  deductedDrsMarked: number;
  paidDrsMarked: number;
}

/**
 * Reconcile one billing week. Caller provides a pool client; we handle the
 * BEGIN/COMMIT/ROLLBACK internally so upstream loops don't have to care.
 *
 * Throws on any DB error, or if the billing week row doesn't exist.
 */
export async function reconcileBillingWeek(
  client: PoolClient,
  billingWeekId: string,
  reconciledBy: string,
): Promise<ReconcileOutcome> {
  await client.query('BEGIN');
  try {
    // ── Load the week row we're reconciling ──────────────────────────────
    const weekRes = await client.query<{
      id: string;
      week_ending: string;
      project: string;
      ft_total_claimable: number;
    }>(
      `SELECT id, week_ending, project, ft_total_claimable
         FROM ft_weekly_billing
        WHERE id = $1`,
      [billingWeekId],
    );
    const week = weekRes.rows[0];
    if (!week) {
      throw new Error(`Billing week ${billingWeekId} not found`);
    }
    const { project, week_ending: weekEnding } = week;

    // ── Load deductions for this week (used in step 6) ───────────────────
    const deductionRes = await client.query<{
      dr_number: string;
      deduction_note: string;
    }>(
      `SELECT dr_number, deduction_note
         FROM ft_billing_deductions
        WHERE billing_week_id = $1`,
      [billingWeekId],
    );

    // ── 1. Cumulative OES activations for the project up to week_ending ─
    const activationRes = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM oes_activations oa
         JOIN drops d ON d.id = oa.drop_id
         JOIN projects p ON p.id = d.project_id
        WHERE p.project_name ILIKE $1
          AND oa.activation_date <= $2`,
      [project, weekEnding],
    );
    const ourTotalActivations = parseInt(activationRes.rows[0]?.count ?? '0', 10);

    // ── 2. Everything already invoiced on earlier weeks ──────────────────
    const prevInvoicedRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(ft_total_claimable), 0) AS total
         FROM ft_weekly_billing
        WHERE project ILIKE $1
          AND week_ending < $2`,
      [project, weekEnding],
    );
    const previouslyInvoiced = parseInt(prevInvoicedRes.rows[0]?.total ?? '0', 10);

    // ── 3. our_claimable = cumulative activations − previously invoiced ─
    const ourClaimable = ourTotalActivations - previouslyInvoiced;

    // ── 4. Outstanding pre-provisions ────────────────────────────────────
    const ppRes = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM oes_pp_data
        WHERE project ILIKE $1
          AND resolution_status != 'activated'`,
      [project],
    );
    const ourPreProvisionsCount = parseInt(ppRes.rows[0]?.count ?? '0', 10);

    // ── 5. Variance vs FT's figure ───────────────────────────────────────
    const ftTotalClaimable = Number(week.ft_total_claimable ?? 0);
    const varianceClaimable = ourClaimable - ftTotalClaimable;

    // ── 6. Update ft_weekly_billing ──────────────────────────────────────
    await client.query(
      `UPDATE ft_weekly_billing SET
         our_total_activations    = $1,
         our_claimable            = $2,
         our_pre_provisions_count = $3,
         variance_claimable       = $4,
         variance_total_onts      = NULL,
         reconciliation_status    = 'reconciled',
         reconciled_at            = NOW(),
         reconciled_by            = $5,
         updated_at               = NOW()
       WHERE id = $6`,
      [
        ourTotalActivations,
        ourClaimable,
        ourPreProvisionsCount,
        varianceClaimable,
        reconciledBy,
        billingWeekId,
      ],
    );

    // ── 7. Tag the deducted DRs on oes_activations ───────────────────────
    let deductedDrsMarked = 0;
    for (const row of deductionRes.rows) {
      const r = await client.query(
        `UPDATE oes_activations
            SET payment_status = 'deducted',
                payment_week   = $1,
                payment_note   = $2
          WHERE drop_number = $3
            AND (payment_status = 'not_yet_claimed' OR payment_status = 'deducted')`,
        [weekEnding, row.deduction_note, row.dr_number],
      );
      deductedDrsMarked += r.rowCount ?? 0;
    }

    // ── 8. Mark newly claimable DRs in the (prevWeek, thisWeek] window
    //       as 'paid', excluding anything tagged 'deducted' above. ─────
    const prevWeekRes = await client.query<{ week_ending: string }>(
      `SELECT week_ending
         FROM ft_weekly_billing
        WHERE project ILIKE $1
          AND week_ending < $2
        ORDER BY week_ending DESC
        LIMIT 1`,
      [project, weekEnding],
    );
    const prevWeekEnding = prevWeekRes.rows[0]?.week_ending ?? null;

    const deductedDrNumbers = deductionRes.rows.map((d) => d.dr_number);
    const paidRes = await client.query(
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
        weekEnding,
        project,
        weekEnding,
        prevWeekEnding,
        deductedDrNumbers.length > 0 ? deductedDrNumbers : null,
      ],
    );
    const paidDrsMarked = paidRes.rowCount ?? 0;

    await client.query('COMMIT');

    return {
      billingWeekId,
      ourTotalActivations,
      ourClaimable,
      ourPreProvisionsCount,
      varianceClaimable,
      deductedDrsMarked,
      paidDrsMarked,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Dispute actions on ft_billing_deductions — shared by the Action Centre
 * Disputes API. Centralises the lifecycle writes:
 *
 *   raise        → resolution_status='disputing'  + oes payment_status='disputed'
 *   mark_outcome → won: 'resolved' + payment 'paid'
 *                  lost/partial: 'disputed' + payment 'deducted'
 *   withdraw     → 'open' + payment 'deducted'
 *
 * payment_status on oes_activations stays in sync with the dispute claim so
 * billing metrics distinguish "FT deducted" from "we are contesting".
 * reconcileBillingWeek never touches 'disputed' rows (it only flips
 * not_yet_claimed/deducted), so the claim survives weekly re-reconciles.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  logNonInvoiceableResolved,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';
import { parseVerdictReasons } from '@/modules/billing/services/classifyDeductionVerdict';

const logger = createLogger('DisputeActions');

export type DisputeAction = 'raise' | 'mark_outcome' | 'withdraw';
export type DisputeOutcome = 'won' | 'lost' | 'partial';

export interface DisputeActionResult {
  id: string;
  drNumber: string;
  noteCode: string;
  weekEnding: string;
  newStatus: string;
  previousStatus: string;
  outcome: DisputeOutcome | null;
  /** false when the oes_activations payment_status sync failed (logged). */
  paymentSynced: boolean;
}

interface DeductionRow {
  id: string;
  dr_number: string;
  deduction_note: string;
  week_ending: string;
  resolution_status: string;
  verdict_reasons: string | null;
}

async function loadDeduction(id: string): Promise<DeductionRow | null> {
  const { rows } = await pool.query<DeductionRow>(
    `SELECT id, dr_number, deduction_note, week_ending::text, resolution_status,
            verdict_evidence->>'reasons' AS verdict_reasons
       FROM ft_billing_deductions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Guarded payment_status transitions — never clobber states the dispute
 * lifecycle doesn't own (oes_activations.drop_number is UNIQUE, so this
 * touches at most one row):
 *   disputed  ← only from not_yet_claimed/deducted (raise)
 *   paid      ← only from disputed (dispute won)
 *   deducted  ← only from disputed (lost/partial/withdraw)
 */
const PAYMENT_TRANSITION_GUARDS: Record<'disputed' | 'paid' | 'deducted', string[]> = {
  disputed: ['not_yet_claimed', 'deducted'],
  paid: ['disputed'],
  deducted: ['disputed'],
};

export async function syncDisputePaymentStatus(
  drNumber: string,
  status: 'disputed' | 'paid' | 'deducted',
): Promise<void> {
  await pool.query(
    `UPDATE oes_activations SET payment_status = $2
      WHERE drop_number = $1 AND payment_status = ANY($3::varchar[])`,
    [drNumber, status, PAYMENT_TRANSITION_GUARDS[status]],
  );
}

function defaultRaiseReason(row: DeductionRow): string | null {
  const reasons = parseVerdictReasons(row.verdict_reasons);
  return reasons.length > 0 ? `auto-verifier: ${reasons.join('; ')}` : null;
}

/**
 * Apply one dispute action to one deduction. Throws on unknown deduction.
 */
export async function applyDisputeAction(params: {
  deductionId: string;
  action: DisputeAction;
  outcome?: DisputeOutcome | null;
  reason?: string | null;
}): Promise<DisputeActionResult> {
  const row = await loadDeduction(params.deductionId);
  if (!row) throw new Error(`Deduction ${params.deductionId} not found`);

  let targetStatus: string;
  let paymentStatus: 'disputed' | 'paid' | 'deducted';
  let emitResolution = false;
  let reason = params.reason?.trim() || null;
  // Only mark_outcome may persist an outcome value.
  let outcomeToWrite: DisputeOutcome | null = null;

  switch (params.action) {
    case 'raise':
      targetStatus = 'disputing';
      paymentStatus = 'disputed';
      reason = reason ?? defaultRaiseReason(row);
      break;
    case 'mark_outcome': {
      const outcome = params.outcome;
      if (!outcome || !['won', 'lost', 'partial'].includes(outcome)) {
        throw new Error('mark_outcome requires outcome in (won|lost|partial)');
      }
      targetStatus = outcome === 'won' ? 'resolved' : 'disputed';
      paymentStatus = outcome === 'won' ? 'paid' : 'deducted';
      emitResolution = outcome === 'won';
      reason = reason ?? `dispute ${outcome}`;
      outcomeToWrite = outcome;
      break;
    }
    case 'withdraw':
      targetStatus = 'open';
      paymentStatus = 'deducted';
      break;
    default:
      throw new Error('Unknown action — must be raise | mark_outcome | withdraw');
  }

  const { rows: updated } = await pool.query<{
    id: string; dr_number: string; deduction_note: string; week_ending: string;
  }>(
    `UPDATE ft_billing_deductions
        SET resolution_status  = $2,
            dispute_outcome    = $3,
            dispute_reason     = COALESCE(NULLIF($4, ''), dispute_reason),
            dispute_opened_at  = CASE
                                   WHEN $2 = 'disputing' AND dispute_opened_at IS NULL THEN NOW()
                                   ELSE dispute_opened_at
                                 END,
            resolved_at        = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
            resolved_reason    = CASE WHEN $2 = 'resolved' THEN COALESCE($4, 'dispute won') ELSE resolved_reason END
      WHERE id = $1
      RETURNING id, dr_number, deduction_note, week_ending::text`,
    [params.deductionId, targetStatus, outcomeToWrite, reason],
  );
  const u = updated[0]!;

  // Keep the billing payment state in step with the dispute claim.
  let paymentSynced = true;
  try {
    await syncDisputePaymentStatus(u.dr_number, paymentStatus);
  } catch (err) {
    paymentSynced = false;
    logger.warn('payment_status sync failed', {
      dr: u.dr_number,
      target: paymentStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (emitResolution) {
    try {
      await logNonInvoiceableResolved(
        u.dr_number,
        {
          weekEnding: u.week_ending,
          noteCode: u.deduction_note as NoteCode,
          resolutionReason: reason ?? 'dispute_won',
          disputeOutcome: params.outcome ?? null,
        },
        'disputes-tab',
      );
    } catch (err) {
      logger.warn('failed to emit non_invoiceable_resolved', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    id: u.id,
    drNumber: u.dr_number,
    noteCode: u.deduction_note,
    weekEnding: u.week_ending,
    newStatus: targetStatus,
    previousStatus: row.resolution_status,
    outcome: outcomeToWrite,
    paymentSynced,
  };
}

/** Apply the same action to many deductions; collects per-row failures. */
export async function applyDisputeActionBulk(params: {
  deductionIds: string[];
  action: DisputeAction;
  outcome?: DisputeOutcome | null;
  reason?: string | null;
}): Promise<{ results: DisputeActionResult[]; failures: Array<{ id: string; error: string }> }> {
  const results: DisputeActionResult[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const deductionId of params.deductionIds) {
    try {
      results.push(await applyDisputeAction({ ...params, deductionId }));
    } catch (err) {
      failures.push({ id: deductionId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, failures };
}

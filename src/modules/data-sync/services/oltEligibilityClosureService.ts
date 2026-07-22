/**
 * OLT eligibility closure — clear open investigate records that FiberTime's
 * own daily OES report declares payable.
 *
 * Since ~2026-07-21 the per-site OES xlsx carries a per-DR "Payment
 * Eligibility" column: 'Eligible', 'Not Eligible' (+ note reasons), or
 * 'PAID - Invoiced on <date>'. When FT marks a DR Eligible or PAID there is
 * no billing hold, so an open Note 2/4 investigate record for it is noise —
 * the population the 2026-07-22 manual cleanup removed (64 paid,
 * never-FT-flagged records).
 *
 * Trust model matches the weekly notes-dropoff closure (#2045): FT's verdict
 * is authoritative. Only a positive 'Eligible' / 'PAID%' value acts;
 * 'Not Eligible' and NULL (site file predates the column) never mutate
 * anything. Pure SQL against freshly-imported oes_activations — no external
 * API calls — so it runs before the 1Map reconciliation sweep and shrinks
 * that sweep's lookup load.
 *
 * Status: WORKING | NLNH Confidence: HIGH
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  closeLinkedTicket,
  getSystemUser,
} from './oltMatchReconciliationService';

const log = createLogger('OltEligibilityClosure');

/** Open, auto-closable states — mirrors the reconciliation sweep's scope. */
const OPEN_STATES = ['not_found', 'serial_other_dr', 'needs_investigation', 'needs_reinvestigation'];

export interface EligibilityClosureResult {
  candidates: number;
  recordsResolved: number;
  ticketsClosed: number;
  ticketFailures: number;
}

interface EligibleRow {
  id: string;
  drop_number: string;
  maintenance_ticket_id: string | null;
  payment_eligibility: string;
}

/** True when FT's eligibility value means "no billing hold". */
export function isPayableEligibility(value: string | null): boolean {
  if (!value) return false;
  const v = value.trim();
  return v === 'Eligible' || v.toUpperCase().startsWith('PAID');
}

/**
 * Close every open OLT mismatch record whose DR the daily OES report marks
 * Eligible or PAID. Sequential; called once per OES import.
 */
export async function processEligibilityClosures(): Promise<EligibilityClosureResult> {
  const result: EligibilityClosureResult = {
    candidates: 0,
    recordsResolved: 0,
    ticketsClosed: 0,
    ticketFailures: 0,
  };

  const { rows } = await pool.query<EligibleRow>(
    `SELECT r.id, r.drop_number, r.maintenance_ticket_id, o.payment_eligibility
     FROM olt_mismatch_records r
     JOIN LATERAL (
       SELECT payment_eligibility FROM oes_activations o
       WHERE o.drop_number = r.drop_number
       ORDER BY o.updated_at DESC NULLS LAST LIMIT 1
     ) o ON true
     WHERE r.fix_status = ANY($1)
       AND (o.payment_eligibility = 'Eligible' OR UPPER(o.payment_eligibility) LIKE 'PAID%')
     ORDER BY r.created_at`,
    [OPEN_STATES],
  );
  result.candidates = rows.length;
  if (rows.length === 0) return result;

  log.info(`FT daily eligibility clears ${rows.length} open OLT investigate records`);
  const systemUser = await getSystemUser();

  for (const row of rows) {
    // Defense in depth: never act on a value the predicate shouldn't have matched.
    if (!isPayableEligibility(row.payment_eligibility)) continue;

    const note =
      `Auto-cleared: FiberTime daily OES report marks ${row.drop_number} as ` +
      `"${row.payment_eligibility}" — no billing hold. Cleared automatically on OES import.`;

    // Guarded on current state so a concurrent manual action wins.
    const upd = await pool.query(
      `UPDATE olt_mismatch_records
       SET fix_status = 'resolved',
           resolution_type = 'ft_payment_eligible',
           resolution_notes = $1,
           resolved_at = NOW(),
           resolved_by = $2
       WHERE id = $3 AND fix_status = ANY($4)`,
      [note, systemUser?.id ?? null, row.id, OPEN_STATES],
    );
    if (upd.rowCount === 0) continue;
    result.recordsResolved++;

    if (row.maintenance_ticket_id) {
      const outcome = await closeLinkedTicket(row.maintenance_ticket_id, note, systemUser);
      if (outcome === 'closed') result.ticketsClosed++;
      if (outcome === 'failed') result.ticketFailures++;
    }
  }

  log.info('OLT eligibility closure done', { data: result });
  return result;
}

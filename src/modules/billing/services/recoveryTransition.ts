/**
 * Pure state-machine decision for the FT expected-recovery loop (audit rec #2).
 *
 * For one (drop_number, deduction_note, deduction-week) recovery episode, given what
 * we already recorded and whether FT is STILL deducting the DR in the bundle being
 * imported, decide the next action. No DB access — every branch is unit-testable
 * (mirrors classifyDeductionVerdict.ts / classifyReconRow.ts).
 *
 * Lifecycle (see migration 415):
 *   (none) + still-deducted   → insert_pending    (assert: FT should drop it next bundle)
 *   (none) + dropped          → insert_recovered  (FT already honoured before we asserted)
 *   pending(prior) + still    → mark_not_returned (a cycle passed, FT still bills → dispute)
 *   pending(prior) + dropped  → mark_recovered    (FT honoured the fix)
 *   pending(this week)        → noop              (one cycle of grace before judging)
 *   recovered + RE-DEDUCTED   → mark_not_returned (FT re-billed a DR it conceded — the
 *                               caller re-marks payment_status deducted, so 'paid' never
 *                               masks a live re-deduction, and it becomes a dispute)
 *   recovered + dropped       → noop              (still honoured)
 *   not_returned              → noop              (already a dispute candidate)
 */

export type RecoveryStatus = 'pending' | 'recovered' | 'not_returned';

export type RecoveryAction =
  | 'insert_pending'
  | 'insert_recovered'
  | 'mark_recovered'
  | 'mark_not_returned'
  | 'noop';

export interface RecoveryDecisionInput {
  /** Existing ft_billing_expected_recovery row for this episode, or null if none. */
  existing: { status: RecoveryStatus; detectedWeekEnding: string } | null;
  /** Is the DR present in the bundle week currently being imported? */
  stillDeductedThisWeek: boolean;
  /** week_ending (ISO yyyy-mm-dd) of the bundle being imported. */
  currentWeekEnding: string;
}

export function decideRecovery(input: RecoveryDecisionInput): RecoveryAction {
  const { existing, stillDeductedThisWeek, currentWeekEnding } = input;

  // First sighting of this fixed-but-deducted episode.
  if (!existing) {
    return stillDeductedThisWeek ? 'insert_pending' : 'insert_recovered';
  }

  // A recovered episode is honoured unless FT re-deducts the same DR, which we treat
  // as a fresh dispute (and the caller flips payment_status back to deducted).
  if (existing.status === 'recovered') {
    return stillDeductedThisWeek ? 'mark_not_returned' : 'noop';
  }

  // Already a dispute candidate — leave the dispute lifecycle to Action Centre.
  if (existing.status === 'not_returned') {
    return 'noop';
  }

  // Pending: only judged once a LATER bundle has arrived. ISO dates compare lexically,
  // so >= means "detected in this same import or later" → one cycle of grace.
  if (existing.detectedWeekEnding >= currentWeekEnding) {
    return 'noop';
  }

  return stillDeductedThisWeek ? 'mark_not_returned' : 'mark_recovered';
}

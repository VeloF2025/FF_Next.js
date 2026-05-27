/**
 * Per-row state derivation for the combined-PDF importer.
 *
 * Pure function so it can be unit-tested in isolation from the API route.
 * Decision tree (in order):
 *
 *   1. No staff matched
 *      └─ a prior skip row exists for this period+empCode → 'previously_skipped'
 *      └─ otherwise                                       → 'unmatched'
 *   2. Staff matched, no existing payslip                 → 'new'
 *   3. Staff matched, existing payslip with same amounts  → 'already_imported'
 *   4. Staff matched, existing payslip with diff amounts  → 'matched_changed'
 */

import type {
  ExistingPayslipSummary,
  PreviousSkipSummary,
  RowState,
  StaffMatchSummary,
} from './types';

export interface DeriveRowStateArgs {
  match: StaffMatchSummary;
  existing: ExistingPayslipSummary | null;
  previousSkip: PreviousSkipSummary | null;
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  nettPayCents: number | null;
}

export function deriveRowState(args: DeriveRowStateArgs): RowState {
  const { match, existing, previousSkip } = args;

  if (!match.staffId) {
    return previousSkip ? 'previously_skipped' : 'unmatched';
  }
  if (!existing) {
    return 'new';
  }
  // Compare only what we actually parsed; null-from-extraction is treated as 0
  // so a re-import where parsing fails for one field doesn't spuriously flip
  // 'already_imported' to 'matched_changed'.
  const totalEarnings = args.totalEarningsCents ?? 0;
  const totalDeductions = args.totalDeductionsCents ?? 0;
  const nett = args.nettPayCents ?? 0;
  const sameAmounts =
    existing.grossCents === totalEarnings &&
    existing.deductionsCents === totalDeductions &&
    existing.netCents === nett;
  return sameAmounts ? 'already_imported' : 'matched_changed';
}

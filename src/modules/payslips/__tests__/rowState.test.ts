/**
 * Tests for the per-row state derivation. Pure function, no DB / no IO.
 */

import { describe, it, expect } from 'vitest';

import { deriveRowState } from '../rowState';
import type {
  ExistingPayslipSummary,
  PreviousSkipSummary,
  StaffMatchSummary,
} from '../types';

const matched: StaffMatchSummary = {
  staffId: '00000000-0000-0000-0000-000000000001',
  staffName: 'Test Person',
  staffEmail: 'test@example.com',
  method: 'id_number',
  confidence: 1,
};
const unmatched: StaffMatchSummary = {
  staffId: null,
  staffName: null,
  staffEmail: null,
  method: 'unmatched',
  confidence: 0,
};
const existingSame: ExistingPayslipSummary = {
  id: 'p1',
  importedAt: '2026-04-28T10:00:00Z',
  grossCents: 2_500_000,
  deductionsCents: 360_000,
  netCents: 2_140_000,
  hasPdf: true,
  pdfStoredFilename: 'abc.pdf',
};
const existingDifferent: ExistingPayslipSummary = {
  ...existingSame,
  netCents: 2_500_000, // diff
};
const previousSkip: PreviousSkipSummary = {
  id: 's1',
  reason: 'Casual not yet onboarded',
  skippedAt: '2026-04-27T09:00:00Z',
};

describe('deriveRowState', () => {
  it('returns "unmatched" when no staff and no prior skip', () => {
    const state = deriveRowState({
      match: unmatched,
      existing: null,
      previousSkip: null,
      totalEarningsCents: 100,
      totalDeductionsCents: 10,
      nettPayCents: 90,
    });
    expect(state).toBe('unmatched');
  });

  it('returns "previously_skipped" when no staff but prior skip exists', () => {
    const state = deriveRowState({
      match: unmatched,
      existing: null,
      previousSkip,
      totalEarningsCents: 100,
      totalDeductionsCents: 10,
      nettPayCents: 90,
    });
    expect(state).toBe('previously_skipped');
  });

  it('returns "new" when staff matched and no existing payslip', () => {
    const state = deriveRowState({
      match: matched,
      existing: null,
      previousSkip: null,
      totalEarningsCents: 2_500_000,
      totalDeductionsCents: 360_000,
      nettPayCents: 2_140_000,
    });
    expect(state).toBe('new');
  });

  it('returns "already_imported" when amounts identical', () => {
    const state = deriveRowState({
      match: matched,
      existing: existingSame,
      previousSkip: null,
      totalEarningsCents: 2_500_000,
      totalDeductionsCents: 360_000,
      nettPayCents: 2_140_000,
    });
    expect(state).toBe('already_imported');
  });

  it('returns "matched_changed" when amounts differ', () => {
    const state = deriveRowState({
      match: matched,
      existing: existingDifferent,
      previousSkip: null,
      totalEarningsCents: 2_500_000,
      totalDeductionsCents: 360_000,
      nettPayCents: 2_140_000,
    });
    expect(state).toBe('matched_changed');
  });

  it('treats null amounts as zero in the diff (does not flip same-amount row)', () => {
    const state = deriveRowState({
      match: matched,
      existing: { ...existingSame, grossCents: 0, deductionsCents: 0, netCents: 0 },
      previousSkip: null,
      totalEarningsCents: null,
      totalDeductionsCents: null,
      nettPayCents: null,
    });
    expect(state).toBe('already_imported');
  });

  it('match wins over previousSkip when both present', () => {
    // If staff was eventually matched, previously_skipped should not apply —
    // the row will land normally and the skip will be auto-resolved.
    const state = deriveRowState({
      match: matched,
      existing: null,
      previousSkip,
      totalEarningsCents: 1,
      totalDeductionsCents: 0,
      nettPayCents: 1,
    });
    expect(state).toBe('new');
  });
});

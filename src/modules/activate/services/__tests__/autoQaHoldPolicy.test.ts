/**
 * Safety invariant for the auto-feedback hold, added after the 2026-07-10 outage:
 * a VLM quality-check failure must never strand FAIL/REWORK feedback to techs.
 * The hold exists only to stop an UNVERIFIED "approved" (PASS) from being sent.
 */
import { describe, it, expect } from 'vitest';
import { shouldHoldForIncompleteQualityCheck } from '../autoQaHoldPolicy';
import type { QaDecision } from '../../types/unified.types';

describe('shouldHoldForIncompleteQualityCheck', () => {
  it('holds a PASS verdict when the visual check could not complete', () => {
    expect(shouldHoldForIncompleteQualityCheck(true, 'PASS')).toBe(true);
  });

  it('does NOT hold FAIL/REWORK when the check is incomplete — their verdict is unaffected', () => {
    // Regression guard for the 2026-07-10 incident: ~200 FAIL DRs were held for
    // days because the hold applied to every decision, not just PASS.
    expect(shouldHoldForIncompleteQualityCheck(true, 'FAIL')).toBe(false);
    expect(shouldHoldForIncompleteQualityCheck(true, 'REWORK_NEEDED')).toBe(false);
  });

  it('never holds when the check completed, regardless of verdict', () => {
    const decisions: QaDecision[] = ['PASS', 'FAIL', 'REWORK_NEEDED'];
    for (const decision of decisions) {
      expect(shouldHoldForIncompleteQualityCheck(false, decision)).toBe(false);
    }
  });
});

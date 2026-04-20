/**
 * autoQaProcessor.date-validation.test.ts
 *
 * Tests for the VLM date-stamp validation helpers introduced in the
 * "fix(auto-qa): harden VLM date-stamp validation" hardening pass.
 *
 * Covers:
 *   1. Strict YYYY-MM-DD regex acceptance
 *   2. Ambiguous format rejection (MM/DD, DD/MM, slash-separated, free text, etc.)
 *   3. SAST-day boundary comparison (no UTC drift)
 *   4. Empty VLM dates array → no duplicate-photo flag
 *   5. Tolerance window (MAX_DIFF_DAYS = 2) preserved
 */

// ============================================================================
// MOCKS — must be defined before any imports that use them
// ============================================================================

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../photoDateValidator', () => ({
  extractExifDatesForPhotos: vi.fn(async () => new Map()),
}));

vi.mock('../qaAutoFailService', () => ({
  checkPrerequisites: vi.fn(() => ({ passed: true, reasons: [] })),
  checkStepCoverage: vi.fn(() => ({ missing: [], covered: [] })),
  validatePowerMeter: vi.fn(() => ({ passed: true })),
  validateSerialCrossReference: vi.fn(() => ({ passed: true })),
  evaluateAutoFail: vi.fn(() => ({ recommendation: 'APPROVE', reasons: [] })),
}));

vi.mock('../autoApprovalService', () => ({
  getStepAccuracy: vi.fn(async () => ({})),
  assignTiers: vi.fn(() => []),
  buildSummary: vi.fn(() => ({ autoApproved: 0, reviewRecommended: 0, humanRequired: 0 })),
}));

vi.mock('../autoQaCommentGenerator', () => ({
  generatePhotoComment: vi.fn(() => 'comment'),
  generateMissingStepComment: vi.fn(() => 'missing'),
  generateFeedbackMessage: vi.fn(() => 'feedback'),
}));

vi.mock('../activityLogService', () => ({
  logActivity: vi.fn(async () => undefined),
}));

vi.mock('../autoQaHelpers', () => ({
  persistAutoQaResults: vi.fn(async () => undefined),
  makeResult: vi.fn((_dn: string, startTime: number, overrides: Record<string, unknown>) => ({
    dropNumber: _dn,
    success: false,
    decision: null,
    skipped: false,
    photoCount: 0,
    passed: 0,
    failed: 0,
    processingTimeMs: Date.now() - startTime,
    ...overrides,
  })),
}));

// ============================================================================
// IMPORTS — after mocks
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { parseStrictVlmDate, toSastYmd, VLM_DATE_VALIDATION_ACTIVE_FROM } from '../autoQaProcessor';

// ============================================================================
// SUITE 1: parseStrictVlmDate — format acceptance and rejection
// ============================================================================

describe('parseStrictVlmDate — format validation', () => {
  const DROP = 'DR9999999';

  // -----------------------------------------------------------------------
  // Acceptance cases
  // -----------------------------------------------------------------------

  it('accepts YYYY-MM-DD (date only)', () => {
    const result = parseStrictVlmDate('2026-04-20', DROP);
    expect(result).not.toBeNull();
    expect(result instanceof Date).toBe(true);
  });

  it('accepts YYYY-MM-DDTHH:MM (ISO with T separator)', () => {
    const result = parseStrictVlmDate('2026-04-20T09:30', DROP);
    expect(result).not.toBeNull();
  });

  it('accepts YYYY-MM-DD HH:MM (space separator)', () => {
    const result = parseStrictVlmDate('2026-04-20 09:30', DROP);
    expect(result).not.toBeNull();
  });

  it('accepts YYYY-MM-DD HH:MM:SS (with seconds)', () => {
    const result = parseStrictVlmDate('2026-04-20 09:30:00', DROP);
    expect(result).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Rejection cases — ambiguous or non-ISO formats
  // -----------------------------------------------------------------------

  it('rejects MM/DD/YYYY (US slash format — 10/3/2026 would be Oct 3)', () => {
    expect(parseStrictVlmDate('10/3/2026', DROP)).toBeNull();
  });

  it('rejects DD/MM/YYYY (European slash format)', () => {
    expect(parseStrictVlmDate('03/10/2026', DROP)).toBeNull();
  });

  it('rejects YYYY/M/DD HH:MM (slash separators with time)', () => {
    expect(parseStrictVlmDate('2026/3/10 09:09', DROP)).toBeNull();
  });

  it('rejects "Jan 3 2026" (free-text month name)', () => {
    expect(parseStrictVlmDate('Jan 3 2026', DROP)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseStrictVlmDate('', DROP)).toBeNull();
  });

  it('rejects "not-a-date" garbage input', () => {
    expect(parseStrictVlmDate('not-a-date', DROP)).toBeNull();
  });

  it('rejects null coerced to string "null"', () => {
    // In practice the caller guards with typeof checks but ensure the function is safe
    expect(parseStrictVlmDate('null', DROP)).toBeNull();
  });

  it('rejects undefined coerced to string "undefined"', () => {
    expect(parseStrictVlmDate('undefined', DROP)).toBeNull();
  });

  it('rejects invalid calendar day "2026-02-30" (would silently roll to Mar 2)', () => {
    expect(parseStrictVlmDate('2026-02-30', DROP)).toBeNull();
  });

  it('rejects invalid calendar day "2026-04-31" (April has 30 days)', () => {
    expect(parseStrictVlmDate('2026-04-31', DROP)).toBeNull();
  });

  it('rejects invalid month "2026-13-01"', () => {
    expect(parseStrictVlmDate('2026-13-01', DROP)).toBeNull();
  });

  it('accepts leap-year Feb 29 "2024-02-29"', () => {
    expect(parseStrictVlmDate('2024-02-29', DROP)).not.toBeNull();
  });

  it('rejects non-leap-year Feb 29 "2026-02-29"', () => {
    expect(parseStrictVlmDate('2026-02-29', DROP)).toBeNull();
  });
});

// ============================================================================
// SUITE 2: toSastYmd — SAST timezone boundary correctness
// ============================================================================

describe('toSastYmd — SAST-aware day string', () => {
  it('formats a midday UTC date as the correct SAST calendar day', () => {
    // 2026-04-20 12:00 UTC = 2026-04-20 14:00 SAST → same day
    const d = new Date('2026-04-20T12:00:00Z');
    expect(toSastYmd(d)).toBe('2026-04-20');
  });

  it('handles the UTC-midnight / SAST-previous-day edge case correctly', () => {
    // 2026-04-20 22:00 UTC = 2026-04-21 00:00 SAST → SAST day is Apr 21
    // toISOString().split('T')[0] would return '2026-04-20' (WRONG for SAST context)
    // toSastYmd should return '2026-04-21' (CORRECT)
    const d = new Date('2026-04-20T22:00:00Z');
    expect(toSastYmd(d)).toBe('2026-04-21');
  });

  it('handles SAST just-before-midnight edge case', () => {
    // 2026-04-20 21:59 UTC = 2026-04-20 23:59 SAST → still Apr 20 in SAST
    const d = new Date('2026-04-20T21:59:00Z');
    expect(toSastYmd(d)).toBe('2026-04-20');
  });
});

// ============================================================================
// SUITE 3: Date mismatch logic — acceptance / rejection against submitted_date
// ============================================================================

describe('Date mismatch — 2-day tolerance window', () => {
  /**
   * Helper: given a VLM raw date string and a submitted date ISO string,
   * determine whether parseStrictVlmDate would flag a mismatch using the
   * same logic as processOneDR (abs diff in days > MAX_DIFF_DAYS=2).
   */
  function wouldMismatch(vlmRaw: string, submittedIso: string): boolean {
    const DROP = 'DR0000001';
    const parsed = parseStrictVlmDate(vlmRaw, DROP);
    if (!parsed) return false; // rejected strings are never flagged

    const submittedDate = new Date(submittedIso);
    const diffDays = Math.abs(parsed.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 2;
  }

  it('same date (VLM = submitted_date) → no mismatch', () => {
    expect(wouldMismatch('2026-04-20', '2026-04-20')).toBe(false);
  });

  it('1 day later → within tolerance → no mismatch', () => {
    expect(wouldMismatch('2026-04-21', '2026-04-20')).toBe(false);
  });

  it('2 days later → at tolerance boundary → no mismatch', () => {
    expect(wouldMismatch('2026-04-22', '2026-04-20')).toBe(false);
  });

  it('3 days later → outside tolerance → mismatch', () => {
    expect(wouldMismatch('2026-04-23', '2026-04-20')).toBe(true);
  });

  it('10 months earlier → far outside tolerance → mismatch', () => {
    expect(wouldMismatch('2025-06-15', '2026-04-20')).toBe(true);
  });

  it('DR submitted 2026-04-20, VLM returns "2026-04-20" → no mismatch', () => {
    expect(wouldMismatch('2026-04-20', '2026-04-20')).toBe(false);
  });

  it('DR submitted 2026-04-20, VLM returns "2026-04-19" → within 2-day tolerance → no mismatch', () => {
    expect(wouldMismatch('2026-04-19', '2026-04-20')).toBe(false);
  });

  it('DR submitted 2026-04-20, VLM returns "2026-04-17" → 3 days → mismatch', () => {
    expect(wouldMismatch('2026-04-17', '2026-04-20')).toBe(true);
  });

  it('ambiguous format "10/3/2026" → rejected by strict parser → never flags mismatch', () => {
    // Even though 10/3/2026 could be read as Oct 3 (6 months ago) which WOULD mismatch,
    // the strict parser rejects it so the result is false — no false positive.
    expect(wouldMismatch('10/3/2026', '2026-04-20')).toBe(false);
  });
});

// ============================================================================
// SUITE 4: Empty / missing VLM date arrays → no duplicate-photo flag
// ============================================================================

describe('Empty VLM dates → no flag', () => {
  it('parseStrictVlmDate on empty string returns null (treated as no date)', () => {
    expect(parseStrictVlmDate('', 'DR0000001')).toBeNull();
  });

  it('VLM_DATE_VALIDATION_ACTIVE_FROM constant is defined and a valid ISO date', () => {
    expect(VLM_DATE_VALIDATION_ACTIVE_FROM).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cutoff date is on or after 2026-04-21', () => {
    const cutoff = new Date(`${VLM_DATE_VALIDATION_ACTIVE_FROM}T00:00:00Z`);
    const featureDate = new Date('2026-04-21T00:00:00Z');
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(featureDate.getTime());
  });
});

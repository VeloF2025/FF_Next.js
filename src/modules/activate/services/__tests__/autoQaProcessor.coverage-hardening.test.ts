/**
 * autoQaProcessor.coverage-hardening.test.ts
 *
 * Tests for the auto-QA coverage hardening (migration 432):
 *   1. findEligibleDRs — 2-day window, attempt cap ($2), oldest-first ordering
 *   2. recordAutoQaAttempt — increments attempts, stamps time, clears prior error
 *   3. recordAutoQaError — persists the reason (truncated), best-effort (never throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => {
  const p = { query: (...args: unknown[]) => query(...args) };
  return { default: p, pool: p };
});

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

// Stub autoQaProcessor's heavy siblings so the module graph resolves under
// vitest (some pull in @/lib/exifUtils etc.). We test only findEligibleDRs
// (pool-only) and the REAL autoQaHelpers, so these stubs' behaviour is irrelevant.
vi.mock('../photoDateValidator', () => ({ extractExifDatesForPhotos: vi.fn(async () => new Map()) }));
vi.mock('../qaAutoFailService', () => ({
  checkPrerequisites: vi.fn(() => ({ passed: true, reasons: [] })),
  checkStepCoverage: vi.fn(() => ({ missing: [], covered: [] })),
  validatePowerMeter: vi.fn(() => ({ passed: true })),
  validateSerialCrossReference: vi.fn(() => ({ passed: true })),
  evaluateAutoFail: vi.fn(() => ({ recommendation: 'APPROVE', reasons: [] })),
  getFailReasonDescription: vi.fn(() => 'desc'),
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
vi.mock('../activityLogService', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('../autoQaDuplicateDetector', () => ({
  flagWithinDrStepDuplicates: vi.fn(() => 0),
  flagDateMismatchDuplicates: vi.fn(async () => undefined),
}));
vi.mock('../autoQaPhotoQualityChecks', () => ({
  applyOntBackCableCheck: vi.fn(async () => 0),
  applyStepQualityCheck: vi.fn(async () => 0),
}));

import { findEligibleDRs } from '../autoQaProcessor';
import {
  recordAutoQaAttempt,
  recordAutoQaError,
  MAX_AUTO_QA_ATTEMPTS,
} from '../autoQaHelpers';

beforeEach(() => {
  query.mockReset();
});

describe('findEligibleDRs — coverage hardening', () => {
  it('windows to 2 days, caps attempts via $2, and orders oldest-first', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await findEligibleDRs(20);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/auto_qa_eligible_at >= NOW\(\) - INTERVAL '2 days'/);
    expect(sql).toMatch(/COALESCE\(auto_qa_attempts, 0\) < \$2/);
    expect(sql).toMatch(/ORDER BY auto_qa_eligible_at ASC/);
    // Must NOT still be newest-first.
    expect(sql).not.toMatch(/ORDER BY auto_qa_eligible_at DESC/);
    expect(params).toEqual([20, MAX_AUTO_QA_ATTEMPTS]);
  });
});

describe('recordAutoQaAttempt', () => {
  it('increments the counter, stamps last_attempt_at, and clears last_error', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await recordAutoQaAttempt('DR123');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/auto_qa_attempts = COALESCE\(auto_qa_attempts, 0\) \+ 1/);
    expect(sql).toMatch(/auto_qa_last_attempt_at = NOW\(\)/);
    expect(sql).toMatch(/auto_qa_last_error = NULL/);
    expect(params).toEqual(['DR123']);
  });
});

describe('recordAutoQaError', () => {
  it('persists the error, truncated to 1000 chars', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await recordAutoQaError('DR123', 'x'.repeat(1500));

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/auto_qa_last_error = \$2/);
    expect(params[0]).toBe('DR123');
    expect((params[1] as string).length).toBe(1000);
  });

  it('never throws even if the UPDATE fails (best-effort)', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(recordAutoQaError('DR123', 'boom')).resolves.toBeUndefined();
  });
});

describe('MAX_AUTO_QA_ATTEMPTS', () => {
  it('parks a DR after 5 attempts', () => {
    expect(MAX_AUTO_QA_ATTEMPTS).toBe(5);
  });
});

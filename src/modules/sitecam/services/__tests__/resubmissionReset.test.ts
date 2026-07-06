/**
 * Regression: a SiteCam (re)submission must reset the prior QA cycle.
 *
 * Found 2026-06-15: re-photographed activations showed a green "Human ✓" badge
 * in the QA Centre because the row still carried feedback_sent=true /
 * a human qa_decision_by from an earlier review. The badge reads that stale
 * state as a fresh human review. resetPriorQaCycleForResubmission clears it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
}));
vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import pool from '@/lib/db';
import { resetPriorQaCycleForResubmission } from '../resubmissionReset';

const mockQuery = vi.mocked(pool.query);

describe('resetPriorQaCycleForResubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the stale QA decision + feedback markers that drive a false "Human ✓"', async () => {
    await resetPriorQaCycleForResubmission('DR1855395');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    // Badge inputs (QaCentrePage.getQaReviewStatus) must be cleared
    expect(sql).toContain('feedback_sent = false');
    expect(sql).toContain('feedback_sent_at = NULL');
    expect(sql).toContain('feedback_message = NULL');
    expect(sql).toContain('qa_decision = NULL');
    expect(sql).toContain('qa_decision_by = NULL');
    // Auto-QA / auto-feedback markers cleared so the new submission is re-evaluated
    expect(sql).toContain('auto_qa_processed = false');
    expect(sql).toContain('auto_feedback_sent_at = NULL');
    // Prior cycle archived + counted, not silently dropped
    expect(sql).toContain('submission_history');
    expect(sql).toContain('submission_count = COALESCE(submission_count, 1) + 1');
    // Guarded so brand-new drops (no prior cycle) are untouched
    expect(sql).toContain('feedback_sent = true OR qa_decision IS NOT NULL OR auto_qa_processed = true');

    expect(params).toEqual(['DR1855395', null]);
  });

  it('swallows DB errors so a failed reset never loses the photo submission', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(resetPriorQaCycleForResubmission('DR1855362')).resolves.toBeUndefined();
  });

  // PWA Phase 2 PR-2: idempotency guard against a lost-ack retry from the
  // offline queue (PR-3). See resubmissionReset.ts docblock for the guard's
  // negative-jsonb-index / replay semantics.
  describe('idempotency (clientSubmissionId replay guard)', () => {
    it('tags the archived snapshot with client_submission_id and binds it as $2', async () => {
      await resetPriorQaCycleForResubmission('DR1', 'uuid-A');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain('client_submission_id');
      expect(sql).toContain(
        "$2 IS NULL OR COALESCE(submission_history -> -1 ->> 'client_submission_id'",
      );
      expect(params).toEqual(['DR1', 'uuid-A']);
    });

    it('legacy call (no clientSubmissionId) binds null for $2', async () => {
      await resetPriorQaCycleForResubmission('DR1');

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(['DR1', null]);
    });
  });
});

/**
 * Regression: persistAutoQaResults must reset the feedback-cycle state when it
 * starts a new QA cycle (pending_hitl). Found 2026-06-12: 101 re-processed DRs
 * carried feedback_sent=true from a 2026-03-18 bulk backfill, so the
 * auto-feedback cron skipped them forever and technicians never got feedback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import pool from '@/lib/db';
import { persistAutoQaResults } from '../autoQaHelpers';
import { evaluateAutoFail, checkStepCoverage } from '../qaAutoFailService';

const mockQuery = vi.mocked(pool.query);

describe('persistAutoQaResults feedback-cycle reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears feedback_sent and all auto-feedback state on a new pending_hitl cycle', async () => {
    const autoFail = { autoFail: false, reasons: [] } as unknown as ReturnType<typeof evaluateAutoFail>;
    const coverage = { covered: [1, 2], missing: [] } as unknown as ReturnType<typeof checkStepCoverage>;

    await persistAutoQaResults(
      'DR_TEST',
      'FAIL',
      autoFail,
      { summary: { decision: 'fail' }, photos: [], validations: [] } as never,
      coverage,
    );

    const updateSql = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes("human_review_status = 'pending_hitl'"));
    expect(updateSql).toBeDefined();
    expect(updateSql).toContain('feedback_sent = false');
    expect(updateSql).toContain('auto_feedback_sent_at = NULL');
    expect(updateSql).toContain('auto_feedback_attempts = 0');
    expect(updateSql).toContain('auto_feedback_skip_reason = NULL');
  });
});

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

    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes("human_review_status = 'pending_hitl'"),
    );
    expect(updateCall).toBeDefined();
    const updateSql = updateCall![0] as string;
    const params = updateCall![1] as unknown[];
    expect(updateSql).toContain('feedback_sent = false');
    expect(updateSql).toContain('auto_feedback_sent_at = NULL');
    expect(updateSql).toContain('auto_feedback_attempts = 0');
    // Skip reason is now parameterised ($17) so it can hold a DR for human review.
    expect(updateSql).toContain('auto_feedback_skip_reason = $17');
    // No hold reason passed → param is null → normal auto-feedback flow.
    expect(params[16]).toBeNull();
  });

  it('holds the DR (sets auto_feedback_skip_reason) when a hold reason is passed', async () => {
    const autoFail = { autoFail: false, reasons: [] } as unknown as ReturnType<typeof evaluateAutoFail>;
    const coverage = { covered: [1, 2], missing: [] } as unknown as ReturnType<typeof checkStepCoverage>;

    await persistAutoQaResults(
      'DR_HOLD',
      'PASS',
      autoFail,
      { summary: { decision: 'pass' }, photos: [], validations: [] } as never,
      coverage,
      undefined,
      'quality_check_incomplete',
    );

    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes("human_review_status = 'pending_hitl'"),
    );
    expect(updateCall).toBeDefined();
    const params = updateCall![1] as unknown[];
    // $17 carries the hold reason → auto-feedback cron skips this DR.
    expect(params[16]).toBe('quality_check_incomplete');
  });
});

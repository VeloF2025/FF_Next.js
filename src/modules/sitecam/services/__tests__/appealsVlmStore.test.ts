vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import { findPendingAppeals, recordEvaluation, recordTransientFailure } from '../appealsVlmStore';
import type { AppealEvaluation } from '../appealsVlmService';

const mockQuery = vi.mocked(pool.query);

const evaluation: AppealEvaluation = {
  recommendation: 'approve', confidence: 0.9, reasoning: 'green cable visible',
  checks: [{ name: 'reason_matches_photo', verdict: 'pass', evidence: 'cable present' }],
  serialRead: null, model: 'qwen/appeal-v1', skipReason: null,
};

describe('appealsVlmStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('findPendingAppeals selects only pending, unscored, under-cap rows', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await findPendingAppeals(10, 3);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('vlm_evaluated_at IS NULL');
    expect(sql).toContain('vlm_attempts');
    expect(sql).toContain('job_type');
  });

  it('recordEvaluation writes vlm_* incl. evaluated_at and NEVER touches status', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await recordEvaluation('appeal-1', evaluation);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE sitecam_appeals');
    expect(sql).toContain('vlm_recommendation');
    expect(sql).toContain('vlm_evaluated_at   = NOW()');
    expect(sql).not.toMatch(/\bstatus\s*=/); // shadow-mode invariant
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params.some((p) => typeof p === 'string' && p.includes('reason_matches_photo'))).toBe(true);
  });

  it('recordTransientFailure bumps attempts, sets skip_reason, leaves evaluated_at NULL, reports parked at cap', async () => {
    mockQuery.mockResolvedValue({ rows: [{ vlm_attempts: 3 }], rowCount: 1 } as never);
    const out = await recordTransientFailure(
      'appeal-1',
      { ...evaluation, recommendation: 'uncertain', skipReason: 'vlm_unavailable' },
      3,
    );
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('vlm_attempts    = COALESCE(vlm_attempts, 0) + 1');
    expect(sql).toContain('vlm_skip_reason');
    expect(sql).not.toContain('vlm_evaluated_at');
    expect(sql).not.toMatch(/\bstatus\s*=/);
    expect(out).toEqual({ attempts: 3, parked: true });
  });

  it('recordTransientFailure reports not-parked below the cap', async () => {
    mockQuery.mockResolvedValue({ rows: [{ vlm_attempts: 1 }], rowCount: 1 } as never);
    const out = await recordTransientFailure(
      'appeal-1',
      { ...evaluation, recommendation: 'uncertain', skipReason: 'vlm_unavailable' },
      3,
    );
    expect(out).toEqual({ attempts: 1, parked: false });
  });
});

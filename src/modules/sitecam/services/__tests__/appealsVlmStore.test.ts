vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import {
  findPendingAppeals,
  findEligibleAppealById,
  isAutoDecideEnabled,
  recordEvaluation,
  recordAutoDecision,
  recordTransientFailure,
} from '../appealsVlmStore';
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

  it('findPendingAppeals binds [maxAttempts, limit] in that order (a swap breaks the attempt cap)', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await findPendingAppeals(10, 3); // limit=10, maxAttempts=3
    // $1 = maxAttempts (compared to vlm_attempts), $2 = limit (LIMIT clause)
    expect(mockQuery.mock.calls[0][1]).toEqual([3, 10]);
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

  it('recordTransientFailure degrades to attempts:0 when RETURNING is empty (stale/deleted id)', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const out = await recordTransientFailure(
      'gone',
      { ...evaluation, recommendation: 'uncertain', skipReason: 'vlm_unavailable' },
      3,
    );
    expect(out).toEqual({ attempts: 0, parked: false });
  });

  it('recordEvaluation is claim-once: returns false when the guarded UPDATE matched no row', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const applied = await recordEvaluation('already-scored', evaluation);
    expect(applied).toBe(false);
    // guard prevents a second writer from overwriting a recorded evaluation
    expect(mockQuery.mock.calls[0][0] as string).toContain('vlm_evaluated_at IS NULL');
  });

  it('isAutoDecideEnabled is true only for the exact string "true"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'true' }], rowCount: 1 } as never);
    expect(await isAutoDecideEnabled()).toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'false' }], rowCount: 1 } as never);
    expect(await isAutoDecideEnabled()).toBe(false);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // flag absent → OFF
    expect(await isAutoDecideEnabled()).toBe(false);
    expect(mockQuery.mock.calls[0][0] as string).toContain('appeals_vlm_autodecide');
  });

  it('findEligibleAppealById guards on pending + unscored and returns null when nothing matches', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const out = await findEligibleAppealById('x');
    expect(out).toBeNull();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('vlm_evaluated_at IS NULL');
  });

  it('recordAutoDecision applies the decision + decided_via=vlm and is guarded against overriding a human', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    const applied = await recordAutoDecision('appeal-1', evaluation, 'approved');
    expect(applied).toBe(true);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/status\s*=\s*\$9/);
    expect(sql).toContain("decided_via        = 'vlm'");
    expect(sql).toContain('decided_by         = NULL');
    // never clobber a decision a human already made, never re-decide a scored row
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('vlm_evaluated_at IS NULL');
    expect(mockQuery.mock.calls[0][1] as unknown[]).toContain('approved');
  });

  it('recordAutoDecision copies the VLM reasoning into denial_reason only on a deny', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
    await recordAutoDecision('appeal-1', { ...evaluation, recommendation: 'deny', reasoning: 'no cable entry visible' }, 'denied');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("denial_reason      = CASE WHEN $9 = 'denied' THEN $4 ELSE denial_reason END");
  });

  it('recordAutoDecision returns false when the guard blocks the write (row no longer pending/unscored)', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const applied = await recordAutoDecision('appeal-1', evaluation, 'denied');
    expect(applied).toBe(false);
  });
});

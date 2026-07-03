vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import { resetReviewCycleForResubmission } from '../reviewCycleReset';

const mockQuery = vi.mocked(pool.query);

describe('resetReviewCycleForResubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
  });

  it('clears the stale feedback + decision markers that drive the false "Human ✓"', async () => {
    await resetReviewCycleForResubmission('DR1863256');
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE dr_photo_unified_reviews');
    expect(sql).toContain('feedback_sent = false');
    expect(sql).toContain('feedback_sent_at = NULL');
    expect(sql).toContain('auto_feedback_sent_at = NULL');
    expect(sql).toContain('qa_decision = NULL');
    expect(sql).toContain('qa_decision_by = NULL');
    expect(sql).toContain('auto_qa_processed = false');
    expect(params).toEqual(['DR1863256']);
  });

  it('only touches rows that carry a prior cycle (no-op guard for fresh drops)', async () => {
    await resetReviewCycleForResubmission('DR1863256');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('feedback_sent = true OR qa_decision IS NOT NULL OR auto_qa_processed = true');
  });

  it('never throws — a failed reset must not drop the submission', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(resetReviewCycleForResubmission('DR1863256')).resolves.toBeUndefined();
  });
});

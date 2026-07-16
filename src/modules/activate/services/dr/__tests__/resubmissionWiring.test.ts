// Verifies the actual fix wiring: resolveUnifiedRecord must call
// resetReviewCycleForResubmission on the two resubmission paths, and must NOT
// call it on the <60s idempotency guard (a benign duplicate delivery must not
// wipe live review state).
//
// It must ALSO leave a pre-existing OES/ack-created record completely untouched
// when process-new-dr is re-invoked WITHOUT WhatsApp context — the internal
// reprocess callers (retry-categorizations, refetch-missing-photos,
// admin/retry-failed) re-run photo fetch + categorisation only. Treating those
// as a "first WA submission" fabricated a submitted_date and flipped
// is_oes_only, re-dating historic OES activations into the current day's
// "Installed" count.
vi.mock('@/lib/db', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../reviewCycleReset', () => ({ resetReviewCycleForResubmission: vi.fn() }));
vi.mock('../drRecordHelpers', () => ({
  flattenContact: () => ({
    subscriber_name: null, subscriber_phone: null, subscriber_email: null,
    subscriber_language: null, signup_agent: null, installer_name: null,
    qcontact_name: null, qcontact_phone: null, qcontact_email: null,
  }),
  createSubmissionSnapshot: () => ({ photo_count: 0, feedback_sent: false }),
}));
vi.mock('../drRecordInserts', () => ({ insertFromQARecord: vi.fn(), insertNewRecord: vi.fn() }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import { resolveUnifiedRecord } from '../drRecordService';
import { resetReviewCycleForResubmission } from '../reviewCycleReset';

const mockReset = vi.mocked(resetReviewCycleForResubmission);
const mockQuery = vi.mocked(pool.query as unknown as (...args: unknown[]) => unknown);

const OLD = new Date(Date.now() - 120_000).toISOString(); // > 60s → past the idempotency guard
const FRESH = new Date(Date.now() - 10_000).toISOString(); // < 60s → duplicate delivery

// A real WhatsApp submission always carries a message id (the Go bridge sets it);
// the internal reprocess crons call process-new-dr with none.
const WA_CONTEXT = { waMessageId: 'wa-msg-1', waSenderJid: 'jid@s.whatsapp.net', waOriginalText: 'DR1863256', waGroupJid: 'grp@g.us' };

function resolveWithUnified(record: Record<string, unknown>, wa: Record<string, unknown> = {}) {
  const params = {
    dropNumber: 'DR1863256', submittedDateStr: '2026-07-06',
    project: 'LAW', expectedProject: 'LAW', senderPhone: null,
    wa, contact: {}, existingUnified: record, existingQA: null,
  };
  return resolveUnifiedRecord(params as unknown as Parameters<typeof resolveUnifiedRecord>[0]);
}

describe('resolveUnifiedRecord — resetReviewCycleForResubmission wiring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT reset on the <60s idempotency guard (duplicate delivery must not wipe review state)', async () => {
    const res = await resolveWithUnified({ created_at: FRESH, submission_count: 1, wa_message_id: 'x', wa_received_at: OLD }, WA_CONTEXT);
    expect(mockReset).not.toHaveBeenCalled();
    expect(res.isResubmission).toBe(false);
  });

  it('resets + converts on the first real WA submission for a pre-existing (OES/ack-created) record', async () => {
    await resolveWithUnified({ created_at: OLD, submission_count: 1, wa_message_id: null, wa_received_at: null, onemap_status: null }, WA_CONTEXT);
    expect(mockReset).toHaveBeenCalledWith('DR1863256');
  });

  it('does NOT reset or write when a pre-existing non-WA record is reprocessed with no WA context (retry/refetch)', async () => {
    const res = await resolveWithUnified({ created_at: OLD, submission_count: 1, wa_message_id: null, wa_received_at: null, onemap_status: null }, {});
    // Reprocess-only: submission metadata (submitted_date, is_oes_only) must be left untouched.
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.isResubmission).toBe(false);
    expect(res.submissionCount).toBe(1);
  });

  it('resets on a genuine resubmission (record already carries WA context)', async () => {
    const res = await resolveWithUnified({ created_at: OLD, submission_count: 2, wa_message_id: 'wa1', wa_received_at: OLD, submission_history: [] }, WA_CONTEXT);
    expect(mockReset).toHaveBeenCalledWith('DR1863256');
    expect(res.isResubmission).toBe(true);
  });
});

// Verifies the actual fix wiring: resolveUnifiedRecord must call
// resetReviewCycleForResubmission on the two resubmission paths, and must NOT
// call it on the <60s idempotency guard (a benign duplicate delivery must not
// wipe live review state).
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
import { resolveUnifiedRecord } from '../drRecordService';
import { resetReviewCycleForResubmission } from '../reviewCycleReset';

const mockReset = vi.mocked(resetReviewCycleForResubmission);

const OLD = new Date(Date.now() - 120_000).toISOString(); // > 60s → past the idempotency guard
const FRESH = new Date(Date.now() - 10_000).toISOString(); // < 60s → duplicate delivery

function resolveWithUnified(record: Record<string, unknown>) {
  const params = {
    dropNumber: 'DR1863256', submittedDateStr: '2026-07-06',
    project: 'LAW', expectedProject: 'LAW', senderPhone: null,
    wa: {}, contact: {}, existingUnified: record, existingQA: null,
  };
  return resolveUnifiedRecord(params as unknown as Parameters<typeof resolveUnifiedRecord>[0]);
}

describe('resolveUnifiedRecord — resetReviewCycleForResubmission wiring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT reset on the <60s idempotency guard (duplicate delivery must not wipe review state)', async () => {
    const res = await resolveWithUnified({ created_at: FRESH, submission_count: 1, wa_message_id: 'x', wa_received_at: OLD });
    expect(mockReset).not.toHaveBeenCalled();
    expect(res.isResubmission).toBe(false);
  });

  it('resets on the first real WA submission for a pre-existing (OES/ack-created) record', async () => {
    await resolveWithUnified({ created_at: OLD, submission_count: 1, wa_message_id: null, wa_received_at: null, onemap_status: null });
    expect(mockReset).toHaveBeenCalledWith('DR1863256');
  });

  it('resets on a genuine resubmission (record already carries WA context)', async () => {
    const res = await resolveWithUnified({ created_at: OLD, submission_count: 2, wa_message_id: 'wa1', wa_received_at: OLD, submission_history: [] });
    expect(mockReset).toHaveBeenCalledWith('DR1863256');
    expect(res.isResubmission).toBe(true);
  });
});

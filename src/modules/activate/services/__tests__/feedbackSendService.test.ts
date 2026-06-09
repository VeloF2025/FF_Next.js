vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import {
  sendPrivateToTech,
  markAutoFeedbackSent,
  markAutoFeedbackSkipped,
} from '../feedbackSendService';

const mockQuery = vi.mocked(pool.query);

describe('sendPrivateToTech', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns success=true when wa-feedback responds ok', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, messageId: 'msg-1' }),
    } as Response);

    const result = await sendPrivateToTech('27821234567@s.whatsapp.net', 'hello', {
      dropNumber: 'DR001',
      project: 'TestProject',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
  });

  it('returns success=false when wa-feedback responds with non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const result = await sendPrivateToTech('27821234567@s.whatsapp.net', 'hello', {
      dropNumber: 'DR001',
      project: null,
    });

    expect(result.success).toBe(false);
  });

  it('returns success=false on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'));

    const result = await sendPrivateToTech('jid', 'msg', { dropNumber: 'DR001', project: null });
    expect(result.success).toBe(false);
  });
});

describe('markAutoFeedbackSent', () => {
  it('updates the correct columns', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await markAutoFeedbackSent('DR001', 'feedback text', 'sent-msg-id');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('auto_feedback_sent_at'),
      ['feedback text', 'DR001', 'sent-msg-id']
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("human_review_status = 'completed'"),
      expect.anything()
    );
  });
});

describe('markAutoFeedbackSkipped', () => {
  it('sets auto_feedback_skip_reason', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await markAutoFeedbackSkipped('DR002', 'no_wa_sender_jid');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('auto_feedback_skip_reason'),
      ['no_wa_sender_jid', 'DR002']
    );
  });
});

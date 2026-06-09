vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/activate/services/feedbackSendService', () => ({
  sendPrivateToTech: vi.fn(),
  markAutoFeedbackSent: vi.fn(),
  markAutoFeedbackSkipped: vi.fn(),
  recordAutoFeedbackFailure: vi.fn(),
}));

vi.mock('@/modules/activate/services/autoQaCommentGenerator', () => ({
  generateFeedbackMessage: vi.fn(() => 'generated feedback'),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import handler from '../auto-feedback';
import {
  sendPrivateToTech,
  markAutoFeedbackSent,
  markAutoFeedbackSkipped,
  recordAutoFeedbackFailure,
} from '@/modules/activate/services/feedbackSendService';

const mockQuery = vi.mocked(pool.query);
const mockSend = vi.mocked(sendPrivateToTech);
const mockMarkSent = vi.mocked(markAutoFeedbackSent);
const mockMarkSkipped = vi.mocked(markAutoFeedbackSkipped);
const mockRecordFailure = vi.mocked(recordAutoFeedbackFailure);

const SECRET = 'test-cron-secret';

/** Default pool.query stub: flag enabled, no eligible DRs. Override per test. */
function stubQuery(opts: { flag?: string; eligible?: unknown[] } = {}) {
  const { flag = 'true', eligible = [] } = opts;
  mockQuery.mockImplementation((async (sql: string) => {
    if (sql.includes('system_flags')) return { rows: [{ value: flag }], rowCount: 1 };
    if (sql.includes('FROM dr_photo_unified_reviews')) return { rows: eligible, rowCount: eligible.length };
    return { rows: [], rowCount: 0 };
  }) as never);
}

function run(headers: Record<string, string>, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, headers });
  return handler(req, res).then(() => res);
}

const AUTH = { authorization: `Bearer ${SECRET}` };
const eligibleDR = {
  drop_number: 'DR001',
  wa_sender_jid: '27821234567@s.whatsapp.net',
  auto_qa_results: { summary: { decision: 'fail' }, photos: [], validations: [] },
  project: 'TestProject',
};

describe('POST /api/cron/auto-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    stubQuery();
  });

  it('rejects non-GET/POST methods with 405', async () => {
    const res = await run(AUTH, 'PUT');
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
  });

  it('returns 401 when the authorization header is missing', async () => {
    const res = await run({});
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    const res = await run({ authorization: 'Bearer nope' });
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns paused:true when the kill switch is off', async () => {
    stubQuery({ flag: 'false' });
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ paused: true, processed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns processed:0 when no DRs are eligible', async () => {
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ paused: false, processed: 0, sent: 0, skipped: 0 });
  });

  it('skips a DR with no wa_sender_jid', async () => {
    stubQuery({ eligible: [{ ...eligibleDR, wa_sender_jid: null }] });
    const res = await run(AUTH);
    expect(mockMarkSkipped).toHaveBeenCalledWith('DR001', 'no_wa_sender_jid');
    expect(mockSend).not.toHaveBeenCalled();
    expect(res._getJSONData().data).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
  });

  it('skips a DR with no auto_qa_results', async () => {
    stubQuery({ eligible: [{ ...eligibleDR, auto_qa_results: null }] });
    await run(AUTH);
    expect(mockMarkSkipped).toHaveBeenCalledWith('DR001', 'no_auto_qa_results');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends feedback and marks sent on the happy path', async () => {
    stubQuery({ eligible: [eligibleDR] });
    mockSend.mockResolvedValue({ success: true, messageId: 'msg-1' });
    const res = await run(AUTH);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockMarkSent).toHaveBeenCalledWith('DR001', 'generated feedback', 'msg-1');
    expect(res._getJSONData().data).toMatchObject({ sent: 1, skipped: 0 });
  });

  it('records a failure (not a send) when WA send returns success:false', async () => {
    stubQuery({ eligible: [eligibleDR] });
    mockSend.mockResolvedValue({ success: false });
    mockRecordFailure.mockResolvedValue({ attempts: 1, capped: false });
    await run(AUTH);
    expect(mockMarkSent).not.toHaveBeenCalled();
    expect(mockRecordFailure).toHaveBeenCalledWith('DR001', 5);
  });

  it('counts a capped failure as skipped', async () => {
    stubQuery({ eligible: [eligibleDR] });
    mockSend.mockResolvedValue({ success: false });
    mockRecordFailure.mockResolvedValue({ attempts: 5, capped: true });
    const res = await run(AUTH);
    expect(res._getJSONData().data).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('returns 500 when the eligible-DR query throws', async () => {
    mockQuery.mockImplementation((async (sql: string) => {
      if (sql.includes('system_flags')) return { rows: [{ value: 'true' }], rowCount: 1 };
      throw new Error('db down');
    }) as never);
    const res = await run(AUTH);
    expect(res._getStatusCode()).toBe(500);
  });
});

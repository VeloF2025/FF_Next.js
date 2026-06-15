/**
 * Route-handler test for GET /api/meetings/[id]/export?type=transcript.
 *
 * Guards the transcript fallback resolver: a meeting can hold multiple
 * meeting_transcripts rows (vtt + whisper-af/-en), so the fallback query must
 * order deterministically (most-recent first) rather than an arbitrary `LIMIT 1`.
 * A regression to an unordered LIMIT 1 would return an arbitrary format's content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Auth seam: withAuth injects a test user and calls through ──────────────────
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => {
      (req as unknown as { user: { email: string } }).user = { email: 'tester@test.com' };
      return handler(req, res);
    },
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── DB seam: record every query and route responses by table ──────────────────
const dbState = {
  meeting: null as Record<string, unknown> | null,
  // ordered rows the meeting_transcripts query "returns"; the resolver must take [0].
  transcriptRows: [] as Array<{ content: string }>,
  queries: [] as string[],
};

vi.mock('@neondatabase/serverless', () => ({
  neon: () =>
    ((strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ');
      dbState.queries.push(q);
      const lower = q.toLowerCase();
      if (lower.includes('from meetings')) {
        return Promise.resolve(dbState.meeting ? [dbState.meeting] : []);
      }
      if (lower.includes('from meeting_transcripts')) {
        return Promise.resolve(dbState.transcriptRows);
      }
      return Promise.resolve([]);
    }),
}));

import handler from '../export';

beforeEach(() => {
  dbState.meeting = null;
  dbState.transcriptRows = [];
  dbState.queries = [];
});

describe('GET /api/meetings/[id]/export?type=transcript', () => {
  it('orders the meeting_transcripts fallback by created_at DESC (deterministic, not an arbitrary LIMIT 1)', async () => {
    // Meeting has no inline transcript → falls back to meeting_transcripts.
    dbState.meeting = {
      id: '7', title: 'Standup', meeting_date: '2026-06-09T10:00:00Z',
      summary: null, raw_transcript: null, user_notes: null,
    };
    // The mock returns whatever the DB would for the (now ordered) query; assert the
    // SQL itself carries the ordering so a regression to unordered LIMIT 1 fails here.
    dbState.transcriptRows = [{ content: 'NEWEST-VTT' }];

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { id: '7', type: 'transcript' },
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    const txQuery = dbState.queries.find((q) => q.toLowerCase().includes('from meeting_transcripts'));
    expect(txQuery).toBeDefined();
    expect(txQuery!.toLowerCase()).toContain('order by created_at desc');
    expect(txQuery!.toLowerCase()).toContain('limit 1');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toBe('NEWEST-VTT');
  });

  it('prefers the inline raw_transcript and skips the meeting_transcripts query entirely', async () => {
    dbState.meeting = {
      id: '7', title: 'Standup', meeting_date: '2026-06-09T10:00:00Z',
      summary: null, raw_transcript: 'INLINE-TRANSCRIPT', user_notes: null,
    };

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { id: '7', type: 'transcript' },
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(dbState.queries.some((q) => q.toLowerCase().includes('from meeting_transcripts'))).toBe(false);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toBe('INLINE-TRANSCRIPT');
  });

  it('returns 404 when neither the inline column nor a meeting_transcripts row has content', async () => {
    dbState.meeting = {
      id: '7', title: 'Standup', meeting_date: '2026-06-09T10:00:00Z',
      summary: null, raw_transcript: null, user_notes: null,
    };
    dbState.transcriptRows = [];

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { id: '7', type: 'transcript' },
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._getStatusCode()).toBe(404);
  });
});

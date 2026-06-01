/**
 * Goal 3b — summary lock: writeSummary() must NOT overwrite a human-reviewed summary.
 *
 * The lock (meetings.summary_source = 'cortex_human_reviewed') is set when a reviewer
 * edits + publishes a summary in the Cortex Scribe panel (written back by the
 * pull-cortex-meeting-actions cron). Centralizing the guard in writeSummary() means ALL
 * regeneration paths (transcript cron, recording-bot, manual /process, graph, onedrive)
 * respect it — "human wins & sticks".
 *
 * We drive the exported writeSummary() directly with a mocked neon seam so we never
 * touch the LLM. The fake sql routes the lock SELECT and records every UPDATE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable lock state + captured UPDATEs (shared with the neon mock below).
// The guard `summary_source IS DISTINCT FROM 'cortex_human_reviewed'` lives in the SQL
// WHERE clause; the fake sql can't evaluate it, so it simulates the row-count the DB
// would return: 0 rows when locked (guard excludes the row), 1 row otherwise.
const dbState = {
  summarySource: null as string | null,
  updates: [] as string[],
};

vi.mock('@/lib/db-neon', () => ({
  neon: () =>
    ((strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ');
      if (/UPDATE meetings/i.test(q)) {
        dbState.updates.push(q);
        const locked = dbState.summarySource === 'cortex_human_reviewed';
        return Promise.resolve(locked ? [] : [{ id: 42 }]);
      }
      return Promise.resolve([]);
    }),
}));

// The LLM client is only used by processWithLLM (not writeSummary); mock it so importing
// the module never reaches for an API key.
vi.mock('@/lib/llm/client', () => ({ getOpenAIClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { writeSummary, type MeetingSummary } from '@/lib/llm/meeting-processor';
import { log } from '@/lib/logger';

function summary(over: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    suggested_title: '',
    overview: 'AI-regenerated overview',
    keywords: ['a'],
    outline: ['x'],
    decisions: ['d'],
    action_items: [],
    ...over,
  };
}

describe('writeSummary — human-reviewed summary lock', () => {
  beforeEach(() => {
    dbState.summarySource = null;
    dbState.updates = [];
    vi.clearAllMocks();
  });

  it('issues an ATOMIC guarded UPDATE (lock predicate in WHERE, not a prior SELECT)', async () => {
    await writeSummary(42, summary());
    expect(dbState.updates).toHaveLength(1);
    const q = dbState.updates[0];
    expect(q).toMatch(/SET\s+summary/i);
    // The guard is the lock — a separate read-then-write would be a TOCTOU race.
    expect(q).toMatch(/summary_source IS DISTINCT FROM 'cortex_human_reviewed'/i);
    expect(q).toMatch(/RETURNING id/i);
  });

  it('preserves a locked summary: 0 rows updated → logs skip, never errors', async () => {
    dbState.summarySource = 'cortex_human_reviewed'; // guard excludes the row → 0 rows
    await writeSummary(42, summary({ overview: 'AI tries to clobber the human text' }));
    expect(dbState.updates).toHaveLength(1); // the guarded UPDATE still runs (matches nothing)
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('locked'),
      { meetingId: 42 },
      'LLMMeetingProcessor',
    );
  });

  it('does NOT log a skip when the row was actually written (unlocked)', async () => {
    dbState.summarySource = null; // 1 row updated
    await writeSummary(42, summary());
    expect(log.info).not.toHaveBeenCalled();
  });
});

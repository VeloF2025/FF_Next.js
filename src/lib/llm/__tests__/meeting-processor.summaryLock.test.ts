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
const dbState = {
  summarySource: null as string | null,
  updates: [] as string[],
};

vi.mock('@/lib/db-neon', () => ({
  neon: () =>
    ((strings: TemplateStringsArray) => {
      const q = (strings as unknown as string[]).join(' ? ');
      if (/SELECT summary_source FROM meetings/i.test(q)) {
        return Promise.resolve([{ summary_source: dbState.summarySource }]);
      }
      if (/UPDATE meetings/i.test(q)) {
        dbState.updates.push(q);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
}));

// The LLM client is only used by processWithLLM (not writeSummary); mock it so importing
// the module never reaches for an API key.
vi.mock('@/lib/llm/client', () => ({ getOpenAIClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { writeSummary, type MeetingSummary } from '@/lib/llm/meeting-processor';

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
  });

  it('writes the summary normally when the meeting is NOT locked', async () => {
    dbState.summarySource = null;
    await writeSummary(42, summary());
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toMatch(/SET\s+summary/i); // the summary column is written
  });

  it('does NOT write the summary column when locked (cortex_human_reviewed)', async () => {
    dbState.summarySource = 'cortex_human_reviewed';
    await writeSummary(42, summary({ overview: 'AI tries to clobber the human text' }));
    // Exactly one UPDATE, and it must NOT touch the summary column (only bookkeeping).
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).not.toMatch(/SET[\s\S]*summary\s*=/i);
    expect(dbState.updates[0]).toMatch(/processing_status/i);
  });

  it('writes normally for any other (non-lock) summary_source value', async () => {
    dbState.summarySource = 'transcript';
    await writeSummary(42, summary());
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toMatch(/SET\s+summary/i);
  });
});

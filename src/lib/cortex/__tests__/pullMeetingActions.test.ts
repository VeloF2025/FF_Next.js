import { describe, it, expect } from 'vitest';
import type { NeonQueryFunction } from '@/lib/db-neon';
import { syncCortexMeetingActions, type FeedResponse } from '@/lib/cortex/pullMeetingActions';

// A fake neon tagged-template `sql`. Routes SELECT → the call-record→id map; records every
// INSERT's bound values so we can assert what was landed. Mirrors how neon() is called
// (sql`...` === sql(stringsArray, ...values)).
// `writebackRows` controls what the guarded write-back UPDATE … RETURNING id returns:
//   [{id}] → a row was written (default); [] → the idempotency guard matched nothing.
function makeFakeSql(idByCallRecord: Record<string, number>, writebackRows: unknown[] = [{ id: 1 }]) {
  const inserts: unknown[][] = [];
  const selects: unknown[] = [];
  const summaryWritebacks: { query: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ');
    if (/SELECT id FROM meetings/i.test(q)) {
      const callRecord = values[0] as string;
      selects.push(callRecord);
      const id = idByCallRecord[callRecord];
      return Promise.resolve(id !== undefined ? [{ id }] : []);
    }
    if (/INSERT INTO cortex_meeting_actions/i.test(q)) {
      inserts.push(values);
      return Promise.resolve([]);
    }
    if (/UPDATE meetings/i.test(q)) {
      summaryWritebacks.push({ query: q, values });
      return Promise.resolve(writebackRows);
    }
    return Promise.resolve([]);
  }) as unknown as NeonQueryFunction<false, false>;
  return { sql, inserts, selects, summaryWritebacks };
}

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

function meeting(over: Partial<FeedResponse['meetings'][number]> = {}) {
  return {
    meeting_id: 'mtg_a',
    source_id: 'cr-1',
    seal_source: 'human',
    human_reviewed: true,
    sealed_at: '2026-05-31T10:00:00Z',
    summary: 'We agreed to ship.',
    items: [
      { action_id: 'a0', meeting_id: 'mtg_a', content_key: 'k0', text: 'Do the thing',
        owner: 'Johan', due: null, confidence: 0.8, source_quotes: [], kind: 'action' },
    ],
    ...over,
  };
}

describe('syncCortexMeetingActions', () => {
  it('maps source_id → FibreFlow meeting id and upserts the meeting', async () => {
    const { sql, inserts, selects } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = { meetings: [meeting()] };

    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch(feed),
    });

    // human_reviewed + mapped → the delivery path also runs: the existence check returns
    // [] in this base harness (not yet created) so one action_items VALUES insert runs
    // (tasksCreated 1) and the ack is treated ok (delivered 1).
    expect(result).toEqual({ pulled: 1, mapped: 1, unmapped: 0, summariesWritten: 1, tasksCreated: 1, machinePublished: 0, delivered: 1, errors: 0 });
    expect(selects).toEqual(['cr-1']);
    expect(inserts).toHaveLength(1);
    // INSERT bound order: meeting_id, source_id, ff_meeting_id, seal_source, human_reviewed,
    // sealed_at, summary, items(json).
    const v = inserts[0];
    expect(v[0]).toBe('mtg_a');
    expect(v[1]).toBe('cr-1');
    expect(v[2]).toBe(92488); // mapped FibreFlow meeting id
    expect(JSON.parse(v[7] as string)[0].action_id).toBe('a0');
  });

  it('lands the meeting as unmapped when no FibreFlow meeting matches the source_id', async () => {
    const { sql, inserts } = makeFakeSql({}); // no mapping
    const feed: FeedResponse = { meetings: [meeting()] };

    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch(feed),
    });

    expect(result).toEqual({ pulled: 1, mapped: 0, unmapped: 1, summariesWritten: 0, tasksCreated: 0, machinePublished: 0, delivered: 0, errors: 0 });
    expect(inserts[0][2]).toBeNull(); // ff_meeting_id is null but the row is still landed
  });

  it('does not issue a lookup for a meeting with no source_id', async () => {
    const { sql, inserts, selects } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = { meetings: [meeting({ source_id: null })] };

    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch(feed),
    });

    expect(selects).toEqual([]); // no SELECT issued
    expect(result).toEqual({ pulled: 1, mapped: 0, unmapped: 1, summariesWritten: 0, tasksCreated: 0, machinePublished: 0, delivered: 0, errors: 0 });
    expect(inserts[0][2]).toBeNull();
  });

  it('is a no-op on an empty feed', async () => {
    const { sql, inserts } = makeFakeSql({});
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch({ meetings: [] }),
    });
    expect(result).toEqual({ pulled: 0, mapped: 0, unmapped: 0, summariesWritten: 0, tasksCreated: 0, machinePublished: 0, delivered: 0, errors: 0 });
    expect(inserts).toHaveLength(0);
  });

  it('throws on a non-OK feed response (so the caller can log/alert)', async () => {
    const { sql } = makeFakeSql({});
    await expect(
      syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch({}, false, 500) }),
    ).rejects.toThrow('500');
  });
});

// ── Goal 3b: write the human-reviewed summary back into meetings.summary ──────────
describe('syncCortexMeetingActions — summary write-back (Goal 3b)', () => {
  it('writes a human-reviewed summary into meetings.summary with the lock marker', async () => {
    const { sql, summaryWritebacks } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = {
      meetings: [meeting({ human_reviewed: true, summary: 'Human-edited exec summary.' })],
    };

    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch(feed),
    });

    expect(result.summariesWritten).toBe(1);
    expect(summaryWritebacks).toHaveLength(1);
    const wb = summaryWritebacks[0];
    // The lock marker is a SQL literal (in the query text); the FF meeting id is bound.
    expect(wb.query).toMatch(/summary_source\s*=\s*'cortex_human_reviewed'/i);
    expect(wb.query).toMatch(/summary_locked_at\s*=\s*NOW\(\)/i);
    // Idempotency guard + RETURNING (so unchanged re-pulls are a no-op, counted correctly).
    expect(wb.query).toMatch(/IS DISTINCT FROM/i);
    expect(wb.query).toMatch(/RETURNING id/i);
    expect(wb.values).toContain(92488);
    // The human text lands as the JSONB summary's overview (structured-object shape).
    const jsonArg = wb.values.find(v => typeof v === 'string' && v.includes('overview')) as string;
    expect(jsonArg).toBeDefined();
    expect(JSON.parse(jsonArg).overview).toBe('Human-edited exec summary.');
  });

  it('does NOT write back when the meeting was auto-sealed (human_reviewed=false)', async () => {
    const { sql, summaryWritebacks } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = {
      meetings: [meeting({ human_reviewed: false, summary: 'AI summary, not human.' })],
    };
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });
    expect(result.summariesWritten).toBe(0);
    expect(summaryWritebacks).toHaveLength(0);
  });

  it('does NOT write back when there is no summary text', async () => {
    const { sql, summaryWritebacks } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = { meetings: [meeting({ human_reviewed: true, summary: null })] };
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });
    expect(result.summariesWritten).toBe(0);
    expect(summaryWritebacks).toHaveLength(0);
  });

  it('does NOT write back when the meeting maps to no FibreFlow row (unmapped)', async () => {
    const { sql, summaryWritebacks } = makeFakeSql({}); // no mapping
    const feed: FeedResponse = {
      meetings: [meeting({ human_reviewed: true, summary: 'Human summary but unmapped.' })],
    };
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });
    expect(result.summariesWritten).toBe(0);
    expect(summaryWritebacks).toHaveLength(0);
  });

  it('is idempotent: an unchanged re-pull issues the guarded UPDATE but counts 0 writes', async () => {
    // Guard matches no row (already locked with the same text) → RETURNING id returns [].
    const { sql, summaryWritebacks } = makeFakeSql({ 'cr-1': 92488 }, []);
    const feed: FeedResponse = {
      meetings: [meeting({ human_reviewed: true, summary: 'Same as last pull.' })],
    };
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });
    expect(summaryWritebacks).toHaveLength(1); // the guarded UPDATE still runs…
    expect(result.summariesWritten).toBe(0);   // …but writes nothing (no re-stamp)
  });
});

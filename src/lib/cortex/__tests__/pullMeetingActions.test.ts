import { describe, it, expect } from 'vitest';
import type { NeonQueryFunction } from '@/lib/db-neon';
import { syncCortexMeetingActions, type FeedResponse } from '@/lib/cortex/pullMeetingActions';

// A fake neon tagged-template `sql`. Routes SELECT → the call-record→id map; records every
// INSERT's bound values so we can assert what was landed. Mirrors how neon() is called
// (sql`...` === sql(stringsArray, ...values)).
function makeFakeSql(idByCallRecord: Record<string, number>) {
  const inserts: unknown[][] = [];
  const selects: unknown[] = [];
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
    return Promise.resolve([]);
  }) as unknown as NeonQueryFunction<false, false>;
  return { sql, inserts, selects };
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

    expect(result).toEqual({ pulled: 1, mapped: 1, unmapped: 0 });
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

    expect(result).toEqual({ pulled: 1, mapped: 0, unmapped: 1 });
    expect(inserts[0][2]).toBeNull(); // ff_meeting_id is null but the row is still landed
  });

  it('does not issue a lookup for a meeting with no source_id', async () => {
    const { sql, inserts, selects } = makeFakeSql({ 'cr-1': 92488 });
    const feed: FeedResponse = { meetings: [meeting({ source_id: null })] };

    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch(feed),
    });

    expect(selects).toEqual([]); // no SELECT issued
    expect(result).toEqual({ pulled: 1, mapped: 0, unmapped: 1 });
    expect(inserts[0][2]).toBeNull();
  });

  it('is a no-op on an empty feed', async () => {
    const { sql, inserts } = makeFakeSql({});
    const result = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', {
      fetchFn: fakeFetch({ meetings: [] }),
    });
    expect(result).toEqual({ pulled: 0, mapped: 0, unmapped: 0 });
    expect(inserts).toHaveLength(0);
  });

  it('throws on a non-OK feed response (so the caller can log/alert)', async () => {
    const { sql } = makeFakeSql({});
    await expect(
      syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch({}, false, 500) }),
    ).rejects.toThrow('500');
  });
});

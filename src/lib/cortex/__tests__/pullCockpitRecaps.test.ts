import { describe, it, expect } from 'vitest';
import type { NeonQueryFunction } from '@/lib/db-neon';
import { syncCortexCockpitRecaps, type CockpitFeedResponse } from '@/lib/cortex/pullCockpitRecaps';

// A fake neon tagged-template `sql` routed by query shape. Records meeting INSERTs and
// action INSERTs so we can assert what was landed and reconciled.
//   - `meetingsByNatKey`: organizer_email(lower) → ff meeting id (natural-key reconcile)
//   - `meetingsByThread`:  teams_meeting_id → ff meeting id (thread+window reconcile)
//   - `existingActionIds`: source_ids already present → action dedup skips them
function makeFakeSql(opts: {
  meetingsByNatKey?: Record<string, number | number[]>;
  meetingsByThread?: Record<string, number>;
  existingActionIds?: Set<string>;
  userIdByName?: Record<string, string>;
  newMeetingId?: number;
} = {}) {
  const meetingInserts: { query: string; values: unknown[] }[] = [];
  const actionInserts: unknown[][] = [];
  const actionUpdates: unknown[][] = [];
  const natKeyLookups: string[] = [];
  const threadLookups: string[] = [];
  const existing = opts.existingActionIds ?? new Set<string>();
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    // normalize whitespace so the multi-line SQL the lib writes matches these shape regexes
    const q = strings.join(' ? ').replace(/\s+/g, ' ');
    if (/SELECT id FROM meetings WHERE lower\(organizer_email\)/i.test(q)) {
      const org = String(values[0]).toLowerCase();
      natKeyLookups.push(org);
      const hit = opts.meetingsByNatKey?.[org];
      const ids = hit === undefined ? [] : Array.isArray(hit) ? hit : [hit];
      return Promise.resolve(ids.map((id) => ({ id })));
    }
    if (/SELECT id FROM meetings WHERE teams_meeting_id/i.test(q)) {
      const tid = String(values[0]);
      threadLookups.push(tid);
      const id = opts.meetingsByThread?.[tid];
      return Promise.resolve(id === undefined ? [] : [{ id }]);
    }
    if (/INSERT INTO meetings/i.test(q)) {
      meetingInserts.push({ query: q, values });
      return Promise.resolve([{ id: opts.newMeetingId ?? 5000 }]);
    }
    if (/SELECT id FROM action_items/i.test(q)) {
      const sourceId = String(values[0]);
      return Promise.resolve(existing.has(sourceId) ? [{ id: 'x' }] : []);
    }
    if (/SELECT id FROM users/i.test(q)) {
      const name = String(values[0]).toLowerCase();
      const id = opts.userIdByName?.[name];
      return Promise.resolve(id ? [{ id }] : []);
    }
    if (/UPDATE action_items/i.test(q)) {
      actionUpdates.push(values);
      return Promise.resolve([]);
    }
    if (/INSERT INTO action_items/i.test(q)) {
      actionInserts.push(values);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as NeonQueryFunction<false, false>;
  return { sql, meetingInserts, actionInserts, actionUpdates, natKeyLookups, threadLookups };
}

function fakeFetch(feedBody: unknown, ackOk = true): typeof fetch {
  return (async (url: string) => {
    if (typeof url === 'string' && url.includes('/recap-delivered')) {
      return { ok: ackOk, status: ackOk ? 200 : 500, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => feedBody } as Response;
  }) as unknown as typeof fetch;
}

function cockpitMeeting(over: Partial<CockpitFeedResponse['meetings'][number]> = {}) {
  return {
    meeting_key: 'cockpit::velocity-fibre::0#19:meeting_X@thread.v2#0',
    teams_meeting_id: '0#19:meeting_X@thread.v2#0',
    title: 'Meeting notes — 2026-06-25',
    organizer_email: null,
    started_at: null,
    captured_at: '2026-06-25T11:20:00+00:00',
    participants: [{ name: 'luke@velocityfibre.co.za', email: 'luke@velocityfibre.co.za' }],
    cockpit_native: true,
    items: [
      { action_id: 'cockpit-abc123', content_key: 'cockpit-abc123', text: 'Order trays',
        owner: 'luke@velocityfibre.co.za', due: null, confidence: 1.0 },
    ],
    ...over,
  };
}

describe('syncCortexCockpitRecaps', () => {
  it('creates a cockpit meeting row + action item + acks for an un-recorded bare meeting', async () => {
    const { sql, meetingInserts, actionInserts } = makeFakeSql({ newMeetingId: 5000 });
    const feed: CockpitFeedResponse = { meetings: [cockpitMeeting()] };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r).toEqual({ pulled: 1, reconciled: 0, created: 1, tasksCreated: 1, tasksUpdated: 0, delivered: 1, errors: 0 });
    // the new meeting row is source='cockpit', carries the thread id + participants
    expect(meetingInserts).toHaveLength(1);
    expect(meetingInserts[0].query).toContain("'cockpit'");       // source literal
    expect(meetingInserts[0].values).toContain('0#19:meeting_X@thread.v2#0'); // teams_meeting_id
    // the action lands against the new meeting id with the unified source_id
    expect(actionInserts).toHaveLength(1);
    expect(actionInserts[0][0]).toBe(5000);                       // meeting_id = new row
    expect(actionInserts[0]).toContain('cockpit-abc123');         // source_id = unified action_id
  });

  it('reconciles with an existing recorded meeting by the natural key (no new row)', async () => {
    const { sql, meetingInserts, actionInserts, natKeyLookups } = makeFakeSql({
      meetingsByNatKey: { 'wayne@velocityfibre.co.za': 92488 },
    });
    const feed: CockpitFeedResponse = {
      meetings: [cockpitMeeting({ organizer_email: 'wayne@velocityfibre.co.za',
                                  started_at: '2026-06-25T11:20:00+00:00' })],
    };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.reconciled).toBe(1);
    expect(r.created).toBe(0);
    expect(meetingInserts).toHaveLength(0);                       // attached to the recorded row, no dup
    expect(natKeyLookups).toEqual(['wayne@velocityfibre.co.za']);
    expect(actionInserts[0][0]).toBe(92488);                      // action lands on the recorded meeting
  });

  it('reconciles a re-pull by teams_meeting_id within the day window (idempotent, no dup row)', async () => {
    const { sql, meetingInserts } = makeFakeSql({
      meetingsByThread: { '0#19:meeting_X@thread.v2#0': 777 },
    });
    const feed: CockpitFeedResponse = { meetings: [cockpitMeeting()] };  // bare → no nat key

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.reconciled).toBe(1);
    expect(meetingInserts).toHaveLength(0);                       // found existing cockpit row, no dup
  });

  it('does NOT wrong-attach on an ambiguous natural key (2+ candidates) — creates its own row', async () => {
    const { sql, meetingInserts } = makeFakeSql({
      meetingsByNatKey: { 'wayne@velocityfibre.co.za': [11, 22] },  // ambiguous
      newMeetingId: 6001,
    });
    const feed: CockpitFeedResponse = {
      meetings: [cockpitMeeting({ organizer_email: 'wayne@velocityfibre.co.za',
                                  started_at: '2026-06-25T11:20:00+00:00' })],
    };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.created).toBe(1);                                    // fail-closed: never guess
    expect(meetingInserts).toHaveLength(1);
  });

  it('UPDATES an action whose source_id already exists (edit/reassign re-syncs, no dup)', async () => {
    const { sql, actionInserts, actionUpdates } = makeFakeSql({
      meetingsByThread: { '0#19:meeting_X@thread.v2#0': 777 },
      existingActionIds: new Set(['cockpit-abc123']),
    });
    const feed: CockpitFeedResponse = {
      meetings: [cockpitMeeting({ items: [
        { action_id: 'cockpit-abc123', content_key: 'cockpit-abc123', text: 'Order 50 trays (edited)',
          owner: 'luke@velocityfibre.co.za', due: null, confidence: 1.0 },
      ] })],
    };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.tasksCreated).toBe(0);
    expect(r.tasksUpdated).toBe(1);
    expect(actionInserts).toHaveLength(0);          // no new row
    expect(actionUpdates).toHaveLength(1);          // the existing row is updated in place
    expect(actionUpdates[0]).toContain('Order 50 trays (edited)'); // new description propagated
  });

  it('creates one FibreFlow action item per owner (the feed serves per-owner items)', async () => {
    const { sql, actionInserts } = makeFakeSql({ newMeetingId: 5000 });
    // Cortex expands a multi-owner action into one feed item per person (distinct source_id).
    const feed: CockpitFeedResponse = {
      meetings: [cockpitMeeting({ items: [
        { action_id: 'act_9::luke@x', content_key: 'cockpit-9', text: 'Order trays',
          owner: 'luke@x', due: null, confidence: 1.0 },
        { action_id: 'act_9::amy@x', content_key: 'cockpit-9', text: 'Order trays',
          owner: 'amy@x', due: null, confidence: 1.0 },
      ] })],
    };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.tasksCreated).toBe(2);
    expect(actionInserts).toHaveLength(2);
    expect(actionInserts.map((v) => v).flat()).toContain('luke@x'); // each row assigned to its owner
    expect(actionInserts.map((v) => v).flat()).toContain('amy@x');
    expect(actionInserts.map((v) => v).flat()).toContain('act_9::luke@x'); // distinct per-owner source_ids
    expect(actionInserts.map((v) => v).flat()).toContain('act_9::amy@x');
  });

  it('matches an action owner to a FibreFlow user by exact name', async () => {
    const { sql, actionInserts } = makeFakeSql({
      newMeetingId: 5000,
      userIdByName: { 'wayne dube': 'user-uuid-1' },
    });
    const feed: CockpitFeedResponse = {
      meetings: [cockpitMeeting({ items: [
        { action_id: 'cockpit-z9', content_key: 'cockpit-z9', text: 'Send the report',
          owner: 'Wayne Dube', due: null, confidence: 1.0 },
      ] })],
    };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed) });

    expect(r.tasksCreated).toBe(1);
    expect(actionInserts[0]).toContain('user-uuid-1');           // assigned_to_user_id resolved
  });

  it('delivery disabled: reconciles the meeting but creates no actions and sends no ack', async () => {
    const { sql, actionInserts } = makeFakeSql({ newMeetingId: 5000 });
    let ackCalled = false;
    const fetchFn = (async (url: string) => {
      if (typeof url === 'string' && url.includes('/recap-delivered')) ackCalled = true;
      return { ok: true, status: 200, json: async () => ({ meetings: [cockpitMeeting()] }) } as Response;
    }) as unknown as typeof fetch;

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn, deliveryEnabled: false });

    expect(r.created).toBe(1);
    expect(r.tasksCreated).toBe(0);
    expect(r.delivered).toBe(0);
    expect(actionInserts).toHaveLength(0);
    expect(ackCalled).toBe(false);
  });

  it('a failed ack does not count as delivered and never throws (retried next pull)', async () => {
    const { sql } = makeFakeSql({ newMeetingId: 5000 });
    const feed: CockpitFeedResponse = { meetings: [cockpitMeeting()] };

    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch(feed, false) });

    expect(r.tasksCreated).toBe(1);   // tasks created (idempotent next pull)
    expect(r.delivered).toBe(0);      // but not acked
    expect(r.errors).toBe(0);
  });

  it('throws on a non-OK feed response', async () => {
    const { sql } = makeFakeSql();
    const fetchFn = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn })).rejects.toThrow(/503/);
  });

  it('an empty feed is a clean no-op', async () => {
    const { sql } = makeFakeSql();
    const r = await syncCortexCockpitRecaps(sql, 'http://bridge:7403', 'key', { fetchFn: fakeFetch({ meetings: [] }) });
    expect(r).toEqual({ pulled: 0, reconciled: 0, created: 0, tasksCreated: 0, tasksUpdated: 0, delivered: 0, errors: 0 });
  });
});

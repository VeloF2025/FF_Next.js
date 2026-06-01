import { describe, it, expect } from 'vitest';
import type { NeonQueryFunction } from '@/lib/db-neon';
import { syncCortexMeetingActions, type FeedResponse } from '@/lib/cortex/pullMeetingActions';

// M2 delivery: a human-reviewed, mapped meeting's approved actions become real FibreFlow
// action_items, then FibreFlow acks Cortex (POST /{id}/outbox/delivered) and stamps a local
// delivered_at so the 30-min re-pull never re-creates or re-acks.
//
// Richer fake `sql` than the base test: the cortex_meeting_actions upsert now RETURNING
// delivered_at (so the module can tell whether this meeting was already delivered locally),
// plus the action_items INSERT and the local delivered_at UPDATE.
function makeFakeSql(opts: {
  idByCallRecord?: Record<string, number>;
  landedDeliveredAt?: string | null;   // what the cortex_meeting_actions upsert RETURNS
  actionExists?: boolean;                // existence-check result (true → task already created)
  assigneeUserId?: string | null;        // users name-match result
} = {}) {
  const idByCallRecord = opts.idByCallRecord ?? { 'cr-1': 92488 };
  const landedDeliveredAt = opts.landedDeliveredAt ?? null;
  const actionExists = opts.actionExists ?? false;
  const assigneeUserId = opts.assigneeUserId ?? null;
  const actionInserts: unknown[][] = [];
  const deliveredMarks: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ');
    if (/SELECT id FROM meetings/i.test(q)) {
      const id = idByCallRecord[values[0] as string];
      return Promise.resolve(id !== undefined ? [{ id }] : []);
    }
    if (/INSERT INTO cortex_meeting_actions/i.test(q)) {
      return Promise.resolve([{ delivered_at: landedDeliveredAt }]);
    }
    if (/SELECT id FROM action_items/i.test(q)) {       // idempotency existence check
      return Promise.resolve(actionExists ? [{ id: 1 }] : []);
    }
    if (/SELECT id FROM users/i.test(q)) {              // assignee name match
      return Promise.resolve(assigneeUserId ? [{ id: assigneeUserId }] : []);
    }
    if (/INSERT INTO action_items/i.test(q)) {          // plain VALUES insert
      actionInserts.push(values);
      return Promise.resolve([]);
    }
    if (/UPDATE cortex_meeting_actions/i.test(q) && /delivered_at\s*=\s*NOW\(\)/i.test(q)) {
      deliveredMarks.push(values);
      return Promise.resolve([]);
    }
    if (/UPDATE meetings/i.test(q)) return Promise.resolve([{ id: 1 }]); // Goal 3b write-back
    return Promise.resolve([]);
  }) as unknown as NeonQueryFunction<false, false>;
  return { sql, actionInserts, deliveredMarks };
}

// Routes the feed GET to the feed body and the ack POST to a (configurable) ack response.
function makeFakeFetch(feed: FeedResponse, ackOk = true): { fetchFn: typeof fetch; acks: string[] } {
  const acks: string[] = [];
  const fetchFn = (async (url: string) => {
    if (/\/outbox\/delivered$/.test(url)) {
      acks.push(url);
      return { ok: ackOk, status: ackOk ? 200 : 502, json: async () => ({ meeting_id: 'x', delivered_at: '2026-06-01T00:00:00Z' }) };
    }
    return { ok: true, status: 200, json: async () => feed };
  }) as unknown as typeof fetch;
  return { fetchFn, acks };
}

function meeting(over: Partial<FeedResponse['meetings'][number]> = {}) {
  return {
    meeting_id: 'mtg_a', source_id: 'cr-1', seal_source: 'human', human_reviewed: true,
    sealed_at: '2026-05-31T10:00:00Z', summary: 'We agreed to ship.',
    items: [
      { action_id: 'a0', meeting_id: 'mtg_a', content_key: 'k0', text: 'Do the thing',
        owner: 'Johan', due: null, confidence: 0.8, source_quotes: [], kind: 'action' },
    ],
    ...over,
  };
}

describe('syncCortexMeetingActions — M2 delivery to FibreFlow tasks', () => {
  it('creates action_items for a human-reviewed mapped meeting and acks Cortex', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql();
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting()] });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.tasksCreated).toBe(1);
    expect(r.delivered).toBe(1);
    expect(actionInserts).toHaveLength(1);
    // Bound values include the FF meeting id, the action text, the owner, and the
    // stable Cortex action_id used as source_id for dedup.
    const v = actionInserts[0];
    expect(v).toContain(92488);
    expect(v).toContain('Do the thing');
    expect(v).toContain('Johan');
    expect(v).toContain('a0');
    expect(acks).toEqual(['http://bridge:7403/api/meetings/mtg_a/outbox/delivered']);
    expect(deliveredMarks).toHaveLength(1); // local delivered_at stamped after ack
  });

  it('does NOT create tasks or ack for an auto-sealed meeting (human_reviewed=false)', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql();
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting({ human_reviewed: false })] });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.tasksCreated).toBe(0);
    expect(r.delivered).toBe(0);
    expect(actionInserts).toHaveLength(0);
    expect(acks).toHaveLength(0);
    expect(deliveredMarks).toHaveLength(0);
  });

  it('skips a meeting already delivered locally (idempotent, no work)', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql({ landedDeliveredAt: '2026-05-31T11:00:00Z' });
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting()] });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.tasksCreated).toBe(0);
    expect(r.delivered).toBe(0);
    expect(actionInserts).toHaveLength(0);
    expect(acks).toHaveLength(0);
    expect(deliveredMarks).toHaveLength(0);
  });

  it('re-pull before local mark: existing tasks are skipped but it still acks once', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql({ actionExists: true }); // already created
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting()] });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.tasksCreated).toBe(0);        // existence check → no new insert
    expect(actionInserts).toHaveLength(0); // INSERT skipped (not run)
    expect(r.delivered).toBe(1);           // ack + local mark still happen
    expect(acks).toHaveLength(1);
    expect(deliveredMarks).toHaveLength(1);
  });

  it('does NOT mark delivered locally when the Cortex ack fails (so the next pull retries)', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql();
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting()] }, false); // ack 502

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(actionInserts).toHaveLength(1); // tasks were created (idempotent on retry)
    expect(r.tasksCreated).toBe(1);
    expect(acks).toHaveLength(1);          // ack was attempted
    expect(r.delivered).toBe(0);           // but not counted delivered
    expect(deliveredMarks).toHaveLength(0); // and local delivered_at NOT stamped
  });

  it('isolates a meeting that throws: counts it as an error and still processes the rest', async () => {
    // The first meeting's landing INSERT throws; the second must still be delivered.
    let firstInsert = true;
    const actionInserts: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join(' ? ');
      if (/SELECT id FROM meetings/i.test(q)) return Promise.resolve([{ id: 92488 }]);
      if (/INSERT INTO cortex_meeting_actions/i.test(q)) {
        if (firstInsert) { firstInsert = false; return Promise.reject(new Error('boom')); }
        return Promise.resolve([{ delivered_at: null }]);
      }
      if (/SELECT id FROM action_items/i.test(q)) return Promise.resolve([]); // not yet created
      if (/SELECT id FROM users/i.test(q)) return Promise.resolve([]);        // no assignee match
      if (/INSERT INTO action_items/i.test(q)) { actionInserts.push(values); return Promise.resolve([]); }
      return Promise.resolve([]);
    }) as unknown as NeonQueryFunction<false, false>;
    const { fetchFn, acks } = makeFakeFetch({
      meetings: [meeting({ meeting_id: 'mtg_bad' }), meeting({ meeting_id: 'mtg_ok' })],
    });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.errors).toBe(1);              // the bad meeting was counted, not fatal
    expect(r.delivered).toBe(1);           // the good meeting still delivered
    expect(actionInserts).toHaveLength(1);
    expect(acks).toEqual(['http://bridge:7403/api/meetings/mtg_ok/outbox/delivered']);
  });

  it('does NOT create tasks for a human-reviewed but UNMAPPED meeting', async () => {
    const { sql, actionInserts, deliveredMarks } = makeFakeSql({ idByCallRecord: {} }); // no mapping
    const { fetchFn, acks } = makeFakeFetch({ meetings: [meeting()] });

    const r = await syncCortexMeetingActions(sql, 'http://bridge:7403', 'key', { fetchFn });

    expect(r.tasksCreated).toBe(0);
    expect(actionInserts).toHaveLength(0);
    expect(acks).toHaveLength(0);
    expect(deliveredMarks).toHaveLength(0);
  });
});

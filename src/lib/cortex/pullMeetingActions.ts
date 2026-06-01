// Cortex Scribe → FibreFlow: pull vetted meeting action items from the Cortex outbox feed.
//
// Cortex turns approved meeting proposed-actions into a governed, pull-only feed
// (GET /api/meetings/outbox/feed; the meeting is SEALED). This module fetches that feed
// and lands each sealed meeting into the `cortex_meeting_actions` table, mapped to our own
// `meetings` row via source_id (= the Cortex record's source_id = our teams_call_record_id).
//
// The HTTP + DB work is isolated here (behind injectable `sql`/`fetchFn` seams) so it is
// unit-testable without a live bridge or DB; the cron handler is a thin auth wrapper.
//
// Contract: references only — an item carries an action reference + summary metadata, never
// raw media. M2: a HUMAN-REVIEWED (human-Published) meeting's approved actions are turned into
// real FibreFlow `action_items` (assigned via name→user match), then FibreFlow acks Cortex
// (POST /{id}/outbox/delivered) which stamps `meeting_outbox.delivered_at`. Auto-sealed
// (human_reviewed=false) meetings stay records only — they never spawn tasks. Delivery is
// idempotent: a local `cortex_meeting_actions.delivered_at` marker + a NOT EXISTS guard on
// `action_items(source_type,source_id)` make the 30-min re-pull a no-op.

import type { NeonQueryFunction } from '@/lib/db-neon';

export interface OutboxItem {
  action_id: string;
  meeting_id: string;
  content_key: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  source_quotes: string[];
  kind: string;
}

export interface OutboxMeeting {
  meeting_id: string;            // Cortex mtg_ hash
  source_id: string | null;     // = teams_call_record_id (join key)
  seal_source: string;          // 'human' | 'auto'
  human_reviewed: boolean;
  sealed_at: string | null;
  summary: string | null;
  items: OutboxItem[];
}

export interface FeedResponse {
  meetings: OutboxMeeting[];
}

export interface SyncResult {
  pulled: number;          // meetings returned by the feed
  mapped: number;          // landed AND matched to a FibreFlow meeting
  unmapped: number;        // landed but no FibreFlow meeting matched the source_id
  summariesWritten: number; // human-reviewed summaries written back into meetings.summary
  tasksCreated: number;    // M2: action_items rows newly created from approved actions
  delivered: number;       // M2: meetings whose actions were delivered + acked to Cortex
}

type Sql = NeonQueryFunction<false, false>;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Pull the Cortex outbox feed and upsert each sealed meeting into cortex_meeting_actions.
 * Returns counts. Throws on a non-OK feed response (so the caller can log/alert); a 200 with
 * an empty meeting list is a normal no-op (nothing sealed/gated yet).
 */
export async function syncCortexMeetingActions(
  sql: Sql,
  bridgeUrl: string,
  apiKey: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<SyncResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  // Key goes in the Authorization header (NOT a query param) so it can't leak into proxy logs.
  const url = `${bridgeUrl}/api/meetings/outbox/feed`;
  const resp = await fetchWithTimeout(fetchFn, url, FETCH_TIMEOUT_MS, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`Cortex outbox feed returned ${resp.status}`);
  }

  const data = (await resp.json()) as FeedResponse;
  const meetings = data.meetings ?? [];
  let mapped = 0;
  let unmapped = 0;
  let summariesWritten = 0;
  let tasksCreated = 0;
  let delivered = 0;

  for (const m of meetings) {
    // Map the Cortex meeting to our own meetings row via source_id (teams_call_record_id).
    let ffMeetingId: number | null = null;
    if (m.source_id) {
      const rows = (await sql`
        SELECT id FROM meetings WHERE teams_call_record_id = ${m.source_id} LIMIT 1
      `) as { id: number }[];
      ffMeetingId = rows[0]?.id ?? null;
    }
    if (ffMeetingId === null) unmapped++;
    else mapped++;

    // RETURNING delivered_at tells us whether THIS meeting was already delivered locally
    // (the ON CONFLICT update deliberately leaves delivered_at untouched) so a re-pull
    // never re-creates tasks or re-acks.
    const landed = (await sql`
      INSERT INTO cortex_meeting_actions
        (cortex_meeting_id, source_id, ff_meeting_id, seal_source, human_reviewed,
         sealed_at, summary, items, pulled_at)
      VALUES
        (${m.meeting_id}, ${m.source_id}, ${ffMeetingId}, ${m.seal_source}, ${m.human_reviewed},
         ${m.sealed_at}, ${m.summary}, ${JSON.stringify(m.items ?? [])}::jsonb, NOW())
      ON CONFLICT (cortex_meeting_id) DO UPDATE SET
        source_id      = EXCLUDED.source_id,
        ff_meeting_id  = EXCLUDED.ff_meeting_id,
        seal_source    = EXCLUDED.seal_source,
        human_reviewed = EXCLUDED.human_reviewed,
        sealed_at      = EXCLUDED.sealed_at,
        summary        = EXCLUDED.summary,
        items          = EXCLUDED.items,
        pulled_at      = NOW()
      RETURNING delivered_at
    `) as { delivered_at: string | null }[];
    const alreadyDelivered = landed[0]?.delivered_at != null;

    // Goal 3b: write a HUMAN-reviewed summary back into meetings.summary as the
    // authoritative override. Only a human seal (human_reviewed) with actual text,
    // mapped to a FibreFlow meeting, qualifies — auto-sealed/AI summaries never
    // overwrite the FibreFlow summary. The lock marker (summary_source) makes
    // writeSummary() preserve it against future LLM/transcript regeneration.
    // meetings.summary is JSONB ({overview, decisions, keywords, outline, action_items});
    // the human free-text lands as `overview` (the executive-summary field the UI shows).
    const humanSummary = m.summary?.trim();
    if (ffMeetingId !== null && m.human_reviewed && humanSummary) {
      const summaryJson = JSON.stringify({
        overview: humanSummary,
        decisions: [],
        keywords: [],
        outline: [],
        action_items: [],
      });
      // Idempotent: the guard makes an unchanged re-pull a no-op (the 30-min cron would
      // otherwise re-stamp summary_locked_at/updated_at every tick). It still writes when
      // the human re-edits the text (summary differs) or the row isn't yet locked.
      // RETURNING id → count only rows actually written.
      const written = (await sql`
        UPDATE meetings
        SET summary           = ${summaryJson}::jsonb,
            summary_source    = 'cortex_human_reviewed',
            summary_locked_at = NOW(),
            updated_at        = NOW()
        WHERE id = ${ffMeetingId}
          AND (summary_source IS DISTINCT FROM 'cortex_human_reviewed'
               OR summary IS DISTINCT FROM ${summaryJson}::jsonb)
        RETURNING id
      `) as unknown[];
      if (written.length > 0) summariesWritten++;
    }

    // M2: turn a HUMAN-reviewed, mapped meeting's approved actions into real FibreFlow
    // action_items, then ack Cortex so it stamps meeting_outbox.delivered_at. Skipped for
    // auto-sealed meetings (records only) and for anything already delivered locally.
    if (ffMeetingId !== null && m.human_reviewed && !alreadyDelivered) {
      let created = 0;
      for (const item of m.items ?? []) {
        const text = item.text?.trim();
        if (!text) continue;
        // Idempotent insert: NOT EXISTS keyed on the stable Cortex action_id. assignee is
        // resolved by the same name→user rule FibreFlow's own action items use (exact
        // first+last match, case-insensitive); no match → assigned_to_user_id stays NULL
        // with the owner preserved in assignee_name (never mis-assigned).
        const inserted = (await sql`
          INSERT INTO action_items
            (meeting_id, description, assignee_name, assigned_to_user_id,
             status, priority, source, source_type, source_id)
          SELECT
            ${ffMeetingId}, ${text}, ${item.owner},
            (SELECT u.id FROM users u
               WHERE ${item.owner} IS NOT NULL AND length(trim(${item.owner})) >= 2
                 AND lower(u.first_name || ' ' || u.last_name) = lower(trim(${item.owner}))
               LIMIT 1),
            'pending', 'medium', 'cortex-scribe', 'cortex_meeting', ${item.action_id}
          WHERE NOT EXISTS (
            SELECT 1 FROM action_items
            WHERE source_type = 'cortex_meeting' AND source_id = ${item.action_id}
          )
          RETURNING id
        `) as unknown[];
        if (inserted.length > 0) created++;
      }
      tasksCreated += created;

      // Ack Cortex (idempotent server-side). Only on a 2xx do we stamp the local
      // delivered_at marker — if the ack fails the meeting stays undelivered locally and
      // the next pull retries (the NOT EXISTS guard makes re-creation a no-op, so no dupes).
      const ackUrl = `${bridgeUrl}/api/meetings/${m.meeting_id}/outbox/delivered`;
      const ack = await fetchWithTimeout(fetchFn, ackUrl, FETCH_TIMEOUT_MS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (ack.ok) {
        await sql`
          UPDATE cortex_meeting_actions SET delivered_at = NOW()
          WHERE cortex_meeting_id = ${m.meeting_id} AND delivered_at IS NULL
        `;
        delivered++;
      }
    }
  }

  return { pulled: meetings.length, mapped, unmapped, summariesWritten, tasksCreated, delivered };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

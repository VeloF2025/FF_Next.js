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
// raw media. Phase 5 (auto-publish): EVERY sealed mapped meeting's actions are turned into
// real FibreFlow `action_items` (assigned via name→user match), then FibreFlow acks Cortex
// (POST /{id}/outbox/delivered) which stamps `meeting_outbox.delivered_at`. Auto-sealed
// (human_reviewed=false) meetings deliver too, tagged `machine_published=true` so they are
// filterable, visually flagged, and bulk-revocable; a human-reviewed seal lands the same way
// with machine_published=false. Only the human summary write-back stays human-only. Delivery
// is idempotent: a local `cortex_meeting_actions.delivered_at` marker + a NOT EXISTS guard on
// `action_items(source_type,source_id)` make the 30-min re-pull a no-op. A kill-switch
// (`deliveryEnabled=false`) halts NEW task creation immediately while still landing records.

import type { NeonQueryFunction } from '@/lib/db-neon';
import { log } from '@/lib/logger';

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
  source_id: string | null;     // = teams_call_record_id for teams_native; a base64
                                 // getAllTranscripts id for teams_artifacts (no GUID match)
  // #103 natural-key fallback: a teams_artifacts source_id never matches a callRecord GUID,
  // so Cortex also exposes the occurrence's organizer + start so we can map by natural key.
  organizer_email?: string | null;
  started_at?: string | null;    // ISO-8601 (UTC); compared to meetings.meeting_date (UTC)
  title?: string | null;
  duration_secs?: number | null;
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
  tasksCreated: number;    // action_items rows newly created from a sealed meeting's actions
  machinePublished: number; // of tasksCreated, how many were auto-sealed (machine_published)
  delivered: number;       // meetings whose actions were delivered + acked to Cortex
  errors: number;          // meetings that threw mid-process (logged, skipped, retried next pull)
}

type Sql = NeonQueryFunction<false, false>;

const FETCH_TIMEOUT_MS = 15_000;
// #103 natural-key fallback window: a Cortex occurrence's started_at and our meeting_date for
// the SAME Teams occurrence agree within a couple of minutes; ±5 min absorbs clock/rounding
// skew while staying tight enough to rarely overlap an adjacent meeting. The fallback is also
// FAIL-CLOSED on ambiguity (2+ candidates in-window → leave unmapped), so the window only
// needs to be tight enough to keep the unique-match rate high, not to guarantee uniqueness.
const NATURAL_KEY_WINDOW_MS = 5 * 60_000;

/**
 * Pull the Cortex outbox feed and upsert each sealed meeting into cortex_meeting_actions.
 * Returns counts. Throws on a non-OK feed response (so the caller can log/alert); a 200 with
 * an empty meeting list is a normal no-op (nothing sealed/gated yet).
 */
export async function syncCortexMeetingActions(
  sql: Sql,
  bridgeUrl: string,
  apiKey: string,
  opts: { fetchFn?: typeof fetch; deliveryEnabled?: boolean } = {},
): Promise<SyncResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  // Kill-switch (Phase 5): when false, we still PULL + land records into
  // cortex_meeting_actions, but create NO new action_items and send NO acks — so a
  // single env flip halts tenant-wide auto-delivery instantly without losing the feed.
  const deliveryEnabled = opts.deliveryEnabled ?? true;
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
  let machinePublished = 0;
  let delivered = 0;
  let errors = 0;

  for (const m of meetings) {
    try {
      // Map the Cortex meeting to our own meetings row via source_id (teams_call_record_id).
      let ffMeetingId: number | null = null;
      if (m.source_id) {
        const rows = (await sql`
          SELECT id FROM meetings WHERE teams_call_record_id = ${m.source_id} LIMIT 1
        `) as { id: number }[];
        ffMeetingId = rows[0]?.id ?? null;
      }
      // #103 fallback: a teams_artifacts meeting's source_id is a base64 getAllTranscripts id,
      // never a callRecord GUID, so the join above misses ~half of sealed meetings. Cortex now
      // exposes organizer_email + started_at, so map by the occurrence natural key (organizer +
      // meeting_date within a window) — the same key our transcript dup-fix already uses. The
      // match is FAIL-CLOSED: map only when exactly ONE meeting is in-window; on 2+ we leave it
      // unmapped (never guess) since a wrong map writes a locked summary + tasks + an irreversible
      // delivery ack. meeting_date is UTC wall-clock (timestamp w/o tz) and Cortex's started_at is
      // UTC ISO, so we compare both as naive UTC.
      if (ffMeetingId === null && m.organizer_email && m.started_at) {
        const startMs = Date.parse(m.started_at);
        if (Number.isFinite(startMs)) {
          const naiveUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
          const lo = naiveUtc(startMs - NATURAL_KEY_WINDOW_MS);
          const hi = naiveUtc(startMs + NATURAL_KEY_WINDOW_MS);
          // Fetch up to 2 so we can detect ambiguity. We deliberately do NOT nearest-match-and-pick:
          // writing a (locked) summary + action_items + an irreversible delivery ack against the
          // WRONG meeting is far worse than leaving it unmapped (FF just keeps summarising it).
          const rows = (await sql`
            SELECT id FROM meetings
            WHERE lower(organizer_email) = lower(${m.organizer_email})
              AND meeting_date BETWEEN ${lo}::timestamp AND ${hi}::timestamp
            LIMIT 2
          `) as { id: number }[];
          if (rows.length === 1) {
            ffMeetingId = rows[0]?.id ?? null;
          } else if (rows.length > 1) {
            // Fail-closed: 2+ same-organizer meetings in the window — can't disambiguate safely.
            log.warn('cortex pull: ambiguous natural-key match; left unmapped', {
              meetingId: m.meeting_id, organizer: m.organizer_email, startedAt: m.started_at,
              candidates: rows.map((r) => r.id),
            });
          }
        }
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

      // Phase 5 auto-publish: turn ANY sealed, mapped meeting's actions into real
      // FibreFlow action_items, then ack Cortex so it stamps meeting_outbox.delivered_at.
      // Auto-sealed actions are tagged machine_published=true (filterable + bulk-revocable);
      // human seals land with machine_published=false. Skipped when the kill-switch is off
      // or the meeting is already delivered locally.
      const isMachinePublished = !m.human_reviewed;
      // Defensive: the tag drives bulk-revoke blast radius, so surface any Cortex-side
      // seal_source/human_reviewed inconsistency rather than mis-tagging silently.
      if ((m.seal_source === 'auto') === m.human_reviewed) {
        log.warn('cortex pull: seal_source/human_reviewed mismatch', {
          meetingId: m.meeting_id, sealSource: m.seal_source, humanReviewed: m.human_reviewed,
        });
      }
      if (deliveryEnabled && ffMeetingId !== null && !alreadyDelivered) {
        let created = 0;
        for (const item of m.items ?? []) {
          const text = item.text?.trim();
          if (!text) continue;
          // Idempotency depends on a stable action_id (→ source_id dedup). Without one,
          // the existence check below is `source_id = NULL` (never matches) and every
          // 30-min pull would re-insert. Skip rather than create undedupable dupes.
          if (!item.action_id) {
            log.warn('cortex pull: item missing action_id; skipping', { meetingId: m.meeting_id });
            continue;
          }
          // NOTE: three SIMPLE statements rather than one INSERT…SELECT…WHERE NOT EXISTS
          // with an embedded scalar subquery. FibreFlow's `sql` driver silently fails on
          // that compound shape; plain VALUES inserts / single-table SELECTs (the shapes
          // used elsewhere in this module) work. Splitting keeps each query in a supported
          // shape — the fix for the M2 delivery never landing tasks.

          // Idempotency: skip if this Cortex action already produced a task (stable action_id).
          const existing = (await sql`
            SELECT id FROM action_items
            WHERE source_type = 'cortex_meeting' AND source_id = ${item.action_id}
            LIMIT 1
          `) as { id: unknown }[];
          if (existing.length > 0) continue;

          // Assignee: exact first+last name match (case-insensitive) — the same exact-match
          // rule FibreFlow's action items use, minus the fuzzy fallback, so we never
          // mis-assign. No match → NULL, with the owner preserved in assignee_name.
          const owner = item.owner?.trim();
          let userId: string | null = null;
          if (owner && owner.length >= 2) {
            const u = (await sql`
              SELECT id FROM users
              WHERE lower(first_name || ' ' || last_name) = lower(${owner})
              LIMIT 1
            `) as { id: string }[];
            userId = u[0]?.id ?? null;
          }

          await sql`
            INSERT INTO action_items
              (meeting_id, description, assignee_name, assigned_to_user_id,
               status, priority, source, source_type, source_id, machine_published)
            VALUES
              (${ffMeetingId}, ${text}, ${item.owner}, ${userId},
               'pending', 'medium', 'cortex-scribe', 'cortex_meeting', ${item.action_id},
               ${isMachinePublished})
          `;
          created++;
        }
        tasksCreated += created;
        if (isMachinePublished) machinePublished += created;

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
    } catch (err) {
      // One malformed meeting must not abort delivery for the rest of the batch.
      // Logged at error level (visible) AND surfaced via SyncResult.errors. The next pull
      // retries; idempotency (existence check + delivered_at) prevents duplicate tasks or
      // double delivery.
      errors++;
      log.error('cortex pull: meeting failed', {
        meetingId: m.meeting_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { pulled: meetings.length, mapped, unmapped, summariesWritten, tasksCreated,
           machinePublished, delivered, errors };
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

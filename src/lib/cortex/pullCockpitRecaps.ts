// Cortex Cockpit → FibreFlow: pull cockpit-native meetings (un-recorded ad-hoc Teams
// meetings where a human logged action items live in the side panel) and land them as
// NORMAL FibreFlow meetings (communications?tab=meetings) + action items.
//
// This is the complement to pullMeetingActions.ts: that one MAPS Cortex's sealed
// (recorded) meetings onto EXISTING FibreFlow `meetings` rows; this one FIND-OR-CREATES a
// row, because an un-recorded ad-hoc meeting has no FibreFlow row (no callRecord, no
// transcript). Cortex serves a dedicated, per-tenant (Velocity-only) feed at
// GET /api/cockpit/recap-feed; we ack each delivery at POST /api/cockpit/recap-delivered
// so Cortex stops re-offering it.
//
// Reconciliation invariant (no duplicate meeting row, no duplicate action item when a
// cockpit meeting is later recorded):
//   1. occurrence-specific NATURAL KEY (organizer_email + meeting_date ±5min) — this both
//      reconciles with a later recorded row AND distinguishes occurrences of a recurring
//      series. Fail-closed on 2+ candidates (never wrong-attach).
//   2. else the Teams thread id (teams_meeting_id) within a ±6h day window — idempotent
//      re-pull + best-effort reconcile, scoped so a recurring series' occurrences (which
//      SHARE a teams_meeting_id) don't collapse into one row.
//   3. else INSERT a new `source='cockpit'` row.
// Action items dedup GLOBALLY on (source_type='cortex_meeting', source_id=action_id); Cortex
// emits the SAME unified action_id from the recorded-seal path, so even if delivery races the
// recording, FibreFlow never double-creates the action.

import type { NeonQueryFunction } from '@/lib/db-neon';
import { log } from '@/lib/logger';

export interface CockpitItem {
  action_id: string;
  content_key: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
}

export interface CockpitMeeting {
  meeting_key: string;            // the full Cortex cockpit live-state key (debug/trace only)
  teams_meeting_id: string | null; // the live Teams thread id (reconciliation token)
  title: string;                  // non-empty (FibreFlow meetings.title is NOT NULL)
  organizer_email: string | null; // present only if the panel stamped getMeetingDetails
  started_at: string | null;      // ISO-8601 (UTC) REAL start (natural key) — null if unstamped
  captured_at: string;            // ISO-8601 (UTC) last-capture time — meeting_date fallback
  participants: { name?: string; email?: string }[];
  cockpit_native: boolean;
  items: CockpitItem[];
}

export interface CockpitFeedResponse {
  meetings: CockpitMeeting[];
}

export interface CockpitSyncResult {
  pulled: number;        // meetings returned by the feed
  reconciled: number;    // attached to an EXISTING FibreFlow meeting row (no dup created)
  created: number;       // landed as a NEW source='cockpit' meeting row
  tasksCreated: number;  // action_items newly created
  tasksUpdated: number;  // action_items UPDATED in place (an edit/reassignment re-synced)
  tasksRemoved: number;  // action_items DELETED because an owner was removed in the cockpit
  delivered: number;     // meetings acked back to Cortex (leave the feed)
  errors: number;        // meetings that threw mid-process (logged, skipped, retried next pull)
}

type Sql = NeonQueryFunction<false, false>;

const FETCH_TIMEOUT_MS = 15_000;
// Occurrence-specific natural-key window (same as pullMeetingActions): a cockpit started_at
// and a recorded meeting_date for the SAME occurrence agree within a couple of minutes.
const NATURAL_KEY_WINDOW_MS = 5 * 60_000;
// Thread-id reconcile window: a teams_meeting_id is the RECURRING series thread, shared across
// occurrences, so a thread match is only trusted within ±6h of the meeting day — enough to be
// idempotent on a 30-min re-pull, tight enough never to collapse two occurrences on different days.
const THREAD_DAY_WINDOW_MS = 6 * 60 * 60_000;

const LOGGER = 'PullCortexCockpitRecaps';

function naiveUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
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

/**
 * Find an existing FibreFlow `meetings` row this cockpit meeting belongs to (reconcile), or
 * create a new `source='cockpit'` row. Returns the row id + whether it was newly created.
 */
async function findOrCreateMeeting(
  sql: Sql,
  m: CockpitMeeting,
): Promise<{ ffMeetingId: number; created: boolean }> {
  // 1. Occurrence-specific natural key — reconciles with a recorded row AND is occurrence-safe.
  if (m.organizer_email && m.started_at) {
    const startMs = Date.parse(m.started_at);
    if (Number.isFinite(startMs)) {
      const lo = naiveUtc(startMs - NATURAL_KEY_WINDOW_MS);
      const hi = naiveUtc(startMs + NATURAL_KEY_WINDOW_MS);
      // LIMIT 2 to detect ambiguity: writing tasks against the WRONG meeting is worse than
      // creating our own row, so on 2+ same-organizer meetings in-window we fall through.
      const rows = (await sql`
        SELECT id FROM meetings
        WHERE lower(organizer_email) = lower(${m.organizer_email})
          AND meeting_date BETWEEN ${lo}::timestamp AND ${hi}::timestamp
        LIMIT 2
      `) as { id: number }[];
      if (rows.length === 1 && rows[0] !== undefined) return { ffMeetingId: rows[0].id, created: false };
      if (rows.length > 1) {
        log.warn('cortex cockpit: ambiguous natural-key match; creating own row', {
          organizer: m.organizer_email, startedAt: m.started_at,
        }, LOGGER);
      }
    }
  }

  // 2. Teams thread id within a day window (idempotent re-pull; occurrence-safe vs recurrence).
  const anchorMs = Date.parse(m.started_at ?? m.captured_at);
  if (m.teams_meeting_id && Number.isFinite(anchorMs)) {
    const lo = naiveUtc(anchorMs - THREAD_DAY_WINDOW_MS);
    const hi = naiveUtc(anchorMs + THREAD_DAY_WINDOW_MS);
    const rows = (await sql`
      SELECT id FROM meetings
      WHERE teams_meeting_id = ${m.teams_meeting_id}
        AND meeting_date BETWEEN ${lo}::timestamp AND ${hi}::timestamp
      LIMIT 2
    `) as { id: number }[];
    if (rows.length === 1 && rows[0] !== undefined) return { ffMeetingId: rows[0].id, created: false };
  }

  // 3. Create a new cockpit meeting row. meeting_date prefers the real start, else the capture
  // time (always present). participants drives non-admin visibility on the meetings tab.
  const dateMs = Number.isFinite(Date.parse(m.started_at ?? ''))
    ? Date.parse(m.started_at as string)
    : Date.parse(m.captured_at);
  const meetingDate = naiveUtc(Number.isFinite(dateMs) ? dateMs : Date.now());
  const participantsJson = JSON.stringify(m.participants ?? []);
  const rows = (await sql`
    INSERT INTO meetings
      (title, meeting_date, source, organizer_email, participants, teams_meeting_id,
       processing_status, created_at, updated_at)
    VALUES
      (${m.title}, ${meetingDate}::timestamp, 'cockpit', ${m.organizer_email},
       ${participantsJson}::jsonb, ${m.teams_meeting_id}, 'completed', NOW(), NOW())
    RETURNING id
  `) as { id: number }[];
  const newId = rows[0]?.id;
  if (newId === undefined) throw new Error('cockpit meeting INSERT returned no id');
  return { ffMeetingId: newId, created: true };
}

/**
 * Pull the Cortex cockpit-recap feed; find-or-create a FibreFlow meeting + action items for
 * each, then ack Cortex. Throws on a non-OK feed (caller logs/alerts); a 200 with no meetings
 * is a normal no-op.
 */
export async function syncCortexCockpitRecaps(
  sql: Sql,
  bridgeUrl: string,
  apiKey: string,
  opts: { fetchFn?: typeof fetch; deliveryEnabled?: boolean } = {},
): Promise<CockpitSyncResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const deliveryEnabled = opts.deliveryEnabled ?? true;
  const resp = await fetchWithTimeout(fetchFn, `${bridgeUrl}/api/cockpit/recap-feed`, FETCH_TIMEOUT_MS, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`Cortex cockpit recap feed returned ${resp.status}`);
  }

  const data = (await resp.json()) as CockpitFeedResponse;
  const meetings = data.meetings ?? [];
  let reconciled = 0;
  let created = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let tasksRemoved = 0;
  let delivered = 0;
  let errors = 0;

  for (const m of meetings) {
    try {
      const { ffMeetingId, created: wasCreated } = await findOrCreateMeeting(sql, m);
      if (wasCreated) created++;
      else reconciled++;

      if (!deliveryEnabled) continue;

      for (const item of m.items ?? []) {
        const text = item.text?.trim();
        if (!text) continue;
        // Idempotency depends on a stable action_id → source_id dedup. Cortex always supplies
        // one (cockpit-<digest>); guard anyway so a malformed item is skipped, not undedupably
        // re-inserted every pull.
        if (!item.action_id) {
          log.warn('cortex cockpit: item missing action_id; skipping', { meetingKey: m.meeting_key }, LOGGER);
          continue;
        }

        // Assignee: exact first+last name match (case-insensitive), same rule as
        // pullMeetingActions — no fuzzy fallback, so we never mis-assign. The owner is often
        // an email (the roster picker), which won't match a name; that's fine → NULL user,
        // owner preserved in assignee_name.
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

        // UPSERT keyed on the STABLE source_id (= the stored cockpit action_id, per owner). An
        // edit/reassignment in the cockpit re-delivers the SAME source_id with new text/owner,
        // so we UPDATE the row in place rather than skipping — keeping FibreFlow in sync with
        // the panel. A re-pull with no change updates to the same values (idempotent no-op).
        // We deliberately do NOT move meeting_id on update (avoid reparenting a task).
        const existing = (await sql`
          SELECT id FROM action_items
          WHERE source_type = 'cortex_meeting' AND source_id = ${item.action_id}
          LIMIT 1
        `) as { id: unknown }[];
        if (existing.length > 0) {
          await sql`
            UPDATE action_items
            SET description = ${text}, assignee_name = ${item.owner},
                assigned_to_user_id = ${userId}, updated_at = NOW()
            WHERE source_type = 'cortex_meeting' AND source_id = ${item.action_id}
          `;
          tasksUpdated++;
          continue;
        }

        // Cockpit captures are HUMAN-asserted (logged live by a participant), so they land
        // machine_published=false — they are not auto-extracted machine output.
        await sql`
          INSERT INTO action_items
            (meeting_id, description, assignee_name, assigned_to_user_id,
             status, priority, source, source_type, source_id, machine_published)
          VALUES
            (${ffMeetingId}, ${text}, ${item.owner}, ${userId},
             'pending', 'medium', 'cortex-scribe', 'cortex_meeting', ${item.action_id}, false)
        `;
        tasksCreated++;
      }

      // Owner-removal propagation: an edit that removes an owner re-delivers the action with
      // FEWER per-owner items (the cockpit edit re-arms the feed). For each delivered base
      // action id, delete the FF rows whose per-owner source_id is no longer present — scoped
      // to that base (never touches other actions or the recorded seal's AI items) and only
      // PENDING machine rows (a human who progressed/completed the task keeps it).
      const deliveredByBase = new Map<string, Set<string>>();
      for (const item of m.items ?? []) {
        if (!item.action_id) continue;
        const base = item.action_id.split('::')[0] ?? item.action_id;
        const set = deliveredByBase.get(base) ?? new Set<string>();
        set.add(item.action_id);
        deliveredByBase.set(base, set);
      }
      for (const [base, current] of deliveredByBase) {
        const prefix = `${base}::`;
        // Scoped to THIS meeting (meeting_id) so the global source_id match can never reach
        // another meeting's row — the upsert already keeps a cockpit action under exactly this
        // ffMeetingId, so its per-owner rows live here too.
        const rows = (await sql`
          SELECT id, source_id, status FROM action_items
          WHERE source_type = 'cortex_meeting'
            AND meeting_id = ${ffMeetingId}
            AND (source_id = ${base} OR left(source_id, ${prefix.length}) = ${prefix})
        `) as { id: unknown; source_id: string; status: string }[];
        for (const row of rows) {
          if (current.has(row.source_id)) continue;   // still delivered → keep
          if (row.status !== 'pending') continue;       // never destroy human-progressed work
          await sql`DELETE FROM action_items WHERE id = ${row.id} AND meeting_id = ${ffMeetingId}`;
          tasksRemoved++;
        }
      }

      // Ack Cortex (idempotent server-side) by the meeting_key (always present + globally
      // unique; Cortex verifies its tenant prefix). Only count delivered on a 2xx so a failed
      // ack leaves the meeting in the feed and the next pull retries (find-or-create + UPSERT
      // make re-processing a no-op, so no dupes).
      const ack = await fetchWithTimeout(fetchFn, `${bridgeUrl}/api/cockpit/recap-delivered`, FETCH_TIMEOUT_MS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_key: m.meeting_key }),
      });
      if (ack.ok) delivered++;
    } catch (err) {
      // One malformed meeting must not abort the rest of the batch.
      errors++;
      log.error('cortex cockpit: meeting failed', {
        meetingKey: m.meeting_key,
        error: err instanceof Error ? err.message : String(err),
      }, LOGGER);
    }
  }

  return { pulled: meetings.length, reconciled, created, tasksCreated, tasksUpdated, tasksRemoved, delivered, errors };
}

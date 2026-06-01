/**
 * Pure logic functions for the cortex/meeting-review proxy.
 *
 * Extracted so they can be unit-tested with injected sql + fetchFn without
 * spinning up a Next.js HTTP server. Pattern mirrors pullMeetingActions.ts.
 *
 * All functions are exported — the route handler imports and calls them;
 * tests import them directly.
 */

import type { NeonQueryFunction } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type { OutboxItem } from '@/lib/cortex/pullMeetingActions';

// ── types ──────────────────────────────────────────────────────────────────────

export interface ReviewQueueEntry {
  meeting_id: string;
  source_id: string;
  title: string;
  business_context: string | null;
  action_count: number;
  processing_status: string;
  updated_at: string;
}

export interface ProposedAction {
  action_id: string;
  text: string;
  owner: string | null;
  due: string | null;
  confidence: number;
  state: string;
  source_quotes: string[];
  history: unknown[];
}

// Cortex /live-state returns `minutes` as an array of running-minute entries
// (NOT a string). Rendering the raw array crashed the panel (React #31).
export interface CortexMinute {
  entry_id: string;
  kind: string;
  text: string;
  content_key?: string;
  segment_index?: number;
  superseded_by?: string | null;
  created_at?: string;
}

export interface LiveStateResponse {
  proposed_actions: ProposedAction[];
  minutes: CortexMinute[] | null;
}

export interface SealedMeetingPanel {
  panelState: 'sealed';
  cortexMeetingId: string;
  sealSource: string;
  humanReviewed: boolean;
  sealedAt: string | null;
  summary: string | null;
  items: OutboxItem[];
}

export interface UnsealedMeetingPanel {
  panelState: 'unsealed';
  cortexMeetingId: string;
  proposedActions: ProposedAction[];
  minutes: CortexMinute[] | null;
  // Effective executive summary (human override if set, else AI) from /{id}/outbox.
  // null when the meeting is gated (not downstream-eligible) or the fetch failed.
  summary: string | null;
}

export interface NoPanelResponse {
  panelState: 'none';
}

export type PanelResponse = SealedMeetingPanel | UnsealedMeetingPanel | NoPanelResponse;

// ── helpers ────────────────────────────────────────────────────────────────────

export type Sql = NeonQueryFunction<false, false>;

const FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // Only install our own timeout abort signal when the caller did not supply one,
  // so an explicit caller-controlled signal is never silently overwritten.
  if (init.signal) {
    return fetchFn(url, init);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── exported pure functions ────────────────────────────────────────────────────

/**
 * Resolve teams_call_record_id for a FibreFlow meeting id.
 * Returns null when the meeting does not exist or has no call record.
 */
export async function resolveCallRecordId(
  sql: Sql,
  ffMeetingId: string,
): Promise<string | null> {
  const rows = (await sql`
    SELECT teams_call_record_id
    FROM   meetings
    WHERE  id = ${ffMeetingId}
    LIMIT  1
  `) as { teams_call_record_id: string | null }[];
  return rows[0]?.teams_call_record_id ?? null;
}

/**
 * Read sealed Cortex data from the local cortex_meeting_actions table.
 * Returns null when no sealed row exists for this FF meeting.
 */
export async function readSealedRow(
  sql: Sql,
  ffMeetingId: string,
): Promise<SealedMeetingPanel | null> {
  const rows = (await sql`
    SELECT cortex_meeting_id, seal_source, human_reviewed, sealed_at, summary, items
    FROM   cortex_meeting_actions
    WHERE  ff_meeting_id = ${ffMeetingId}
    LIMIT  1
  `) as {
    cortex_meeting_id: string;
    seal_source: string;
    human_reviewed: boolean;
    sealed_at: string | null;
    summary: string | null;
    items: OutboxItem[];
  }[];

  const row = rows[0];
  if (!row) return null;

  return {
    panelState: 'sealed',
    cortexMeetingId: row.cortex_meeting_id,
    sealSource: row.seal_source,
    humanReviewed: row.human_reviewed,
    sealedAt: row.sealed_at,
    summary: row.summary,
    items: Array.isArray(row.items) ? row.items : [],
  };
}

/**
 * Find the Cortex meeting_id for an unsealed meeting by scanning /review-queue.
 * Returns null when this call-record-id is not currently in the queue.
 */
export async function resolveUnsealedMeetingId(
  callRecordId: string,
  reviewerEmail: string,
  bridgeUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${bridgeUrl}/api/meetings/review-queue`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Cortex-Reviewer': reviewerEmail,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  const resp = await fetchWithTimeout(fetchFn, url, { headers });
  if (!resp.ok) {
    log.warn('Cortex review-queue returned non-OK', { status: resp.status }, 'cortex-meeting-review');
    return null;
  }
  const data = (await resp.json()) as { meetings?: ReviewQueueEntry[] };
  const queue: ReviewQueueEntry[] = data.meetings ?? (Array.isArray(data) ? (data as ReviewQueueEntry[]) : []);
  const match = queue.find(e => e.source_id === callRecordId);
  return match?.meeting_id ?? null;
}

/**
 * Fetch /live-state for a Cortex meeting_id.
 */
export async function fetchLiveState(
  cortexMeetingId: string,
  reviewerEmail: string,
  bridgeUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<LiveStateResponse | null> {
  const url = `${bridgeUrl}/api/meetings/${encodeURIComponent(cortexMeetingId)}/live-state`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Cortex-Reviewer': reviewerEmail,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  const resp = await fetchWithTimeout(fetchFn, url, { headers });
  if (!resp.ok) {
    log.warn('Cortex live-state returned non-OK', { cortexMeetingId, status: resp.status }, 'cortex-meeting-review');
    return null;
  }
  return (await resp.json()) as LiveStateResponse;
}

/**
 * Fetch the effective summary for a Cortex meeting from /{id}/outbox.
 *
 * The outbox endpoint returns the EFFECTIVE summary — the human override if one was
 * set (Goal 3a), else the AI summary. Used to surface + pre-fill the summary editor in
 * the unsealed panel. Returns null on a non-OK response or when the meeting is gated
 * (not downstream-eligible) — both are non-fatal: the panel just shows no summary.
 */
export async function fetchOutboxSummary(
  cortexMeetingId: string,
  reviewerEmail: string,
  bridgeUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${bridgeUrl}/api/meetings/${encodeURIComponent(cortexMeetingId)}/outbox`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Cortex-Reviewer': reviewerEmail,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  // Non-fatal: a thrown fetch (timeout/abort/network) or non-OK response must not break
  // the panel GET — the summary is supplementary, so swallow to null.
  try {
    const resp = await fetchWithTimeout(fetchFn, url, { headers });
    if (!resp.ok) {
      log.warn('Cortex outbox returned non-OK', { cortexMeetingId, status: resp.status }, 'cortex-meeting-review');
      return null;
    }
    const data = (await resp.json()) as { summary?: unknown };
    // Defend against an unexpected non-string summary (would render as [object Object]).
    return typeof data.summary === 'string' ? data.summary : null;
  } catch (err) {
    log.warn('Cortex outbox fetch failed', { cortexMeetingId, error: err instanceof Error ? err.message : String(err) }, 'cortex-meeting-review');
    return null;
  }
}

/**
 * Delete the local cortex_meeting_actions row for a FibreFlow meeting.
 * Called on re-open (unpublish) to prevent a stale sealed view (spec §4.4).
 */
export async function deleteLocalSealedRow(
  sql: Sql,
  ffMeetingId: string,
): Promise<void> {
  await sql`
    DELETE FROM cortex_meeting_actions
    WHERE  ff_meeting_id = ${ffMeetingId}
  `;
}

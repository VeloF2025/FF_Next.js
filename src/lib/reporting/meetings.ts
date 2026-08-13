/**
 * Meeting search, scoped to the meetings the caller actually attended.
 *
 * Backs `find_meetings`. It deliberately does NOT reuse the rule in
 * pages/api/meetings.ts, which grants access on a NAME match as well as an email one:
 *
 *     WHERE LOWER(p->>'email')       = $userEmail
 *        OR LOWER(p->>'name')        = $userName
 *        OR LOWER(p->>'displayName') = $userName
 *
 * A display name is not an identity. Measured against live data: two active accounts share
 * the name "hein van vuuren", so the technician-role one (0823216574@phone.local) matches
 * 435 meetings on the strength of a string; and 1,613 meetings carry a participant whose
 * name is the empty string, which any user created without a first or last name would
 * match wholesale, because `user.name` falls back to ''. No such user exists today, so that
 * one is latent rather than live — but it is a fail-OPEN default, and this tool hands its
 * output to an agent.
 *
 * Email only, via the shared predicate the action-item routes use.
 */

import { meetingAttendance, type ActionItemAccess } from '@/lib/actionItems/meetingAccess';
import { measure, type Measure } from './coverage';

/** Hard ceiling. A model asking for "all meetings" should get a bounded, honest answer. */
export const MAX_MEETINGS = 50;

export interface MeetingFilter {
  search?: string;
  since?: string;
  until?: string;
  withTranscript?: boolean;
  limit: number;
}

export interface MeetingRow {
  id: number;
  title: string | null;
  meeting_date: Date | null;
  duration: number | null;
  source: string | null;
  participant_count: number;
  has_transcript: boolean;
  has_summary: boolean;
  action_item_count: number;
}

export interface MeetingsReport {
  meetings: Array<{
    id: number;
    title: string;
    date: string | null;
    durationMinutes: number | null;
    source: string | null;
    participants: number;
    hasTranscript: boolean;
    hasSummary: boolean;
    actionItems: number;
  }>;
  matched: Measure;
  caveats: string[];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Only the first value of a repeated query parameter — see the note in listQuery.ts. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
  return value;
}

/** `YYYY-MM-DD` only. Anything looser reaches Postgres as a date cast and 500s. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseMeetingFilter(
  query: Record<string, string | string[] | undefined>,
): { filter: MeetingFilter } | { error: string } {
  const search = one(query.search)?.trim();
  const since = one(query.since)?.trim();
  const until = one(query.until)?.trim();
  const withTranscript = one(query.withTranscript);
  const rawLimit = one(query.limit)?.trim();

  for (const [name, value] of [['since', since], ['until', until]] as const) {
    if (value && !ISO_DATE.test(value)) {
      return { error: `${name} must be a date in YYYY-MM-DD form` };
    }
  }

  // An unparseable limit becomes the default rather than 1 — `Number('')` is 0, and a
  // silent limit of 1 reads to a model as "there is only one meeting".
  let limit = MAX_MEETINGS;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit)) return { error: 'limit must be a positive integer' };
    limit = Math.min(MAX_MEETINGS, Math.max(1, Number(rawLimit)));
  }

  if (withTranscript && !['true', 'false'].includes(withTranscript)) {
    return { error: 'withTranscript must be true or false' };
  }

  return {
    filter: {
      search: search || undefined,
      since: since || undefined,
      until: until || undefined,
      withTranscript: withTranscript ? withTranscript === 'true' : undefined,
      limit,
    },
  };
}

export function meetingsQuery(
  filter: MeetingFilter,
  access: ActionItemAccess,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (value: unknown) => `$${params.push(value)}`;

  // Attendance first and unconditional, from the shared module — the same definition the
  // action-item routes use, applied directly to the meetings row.
  const where: string[] = [meetingAttendance(access, params, 'm')];

  if (filter.search) {
    where.push(`m.title ILIKE ${push(`%${escapeLike(filter.search)}%`)}`);
  }
  if (filter.since) where.push(`m.meeting_date >= ${push(filter.since)}::date`);
  // The whole of `until` day, not midnight at its start.
  if (filter.until) where.push(`m.meeting_date < (${push(filter.until)}::date + 1)`);
  if (filter.withTranscript === true) where.push(`m.raw_transcript IS NOT NULL`);
  if (filter.withTranscript === false) where.push(`m.raw_transcript IS NULL`);

  const scope = where.join('\n      AND ');

  return {
    sql: `
      WITH scoped AS (
        SELECT m.id, m.title, m.meeting_date, m.duration, m.source,
               jsonb_array_length(COALESCE(m.participants, '[]'::jsonb)) AS participant_count,
               (m.raw_transcript IS NOT NULL) AS has_transcript,
               (m.summary IS NOT NULL) AS has_summary
        FROM meetings m
        WHERE ${scope}
      )
      SELECT s.*,
             (SELECT count(*) FROM action_items a WHERE a.meeting_id = s.id)::int AS action_item_count,
             (SELECT count(*) FROM scoped)::int AS total_matched
      FROM scoped s
      ORDER BY s.meeting_date DESC NULLS LAST
      LIMIT ${filter.limit}`,
    params,
  };
}

export function shapeMeetings(
  rows: Array<MeetingRow & { total_matched?: number }>,
  filter: MeetingFilter,
  isOwner: boolean,
): MeetingsReport {
  const total = rows[0]?.total_matched ?? 0;

  const meetings = rows.map((r) => ({
    id: r.id,
    title: r.title ?? '(untitled)',
    // A DATE/timestamp rendered with toISOString() can move a meeting a day earlier in
    // SAST. Format from the local parts instead.
    date: r.meeting_date ? formatDate(r.meeting_date) : null,
    durationMinutes: r.duration ?? null,
    source: r.source,
    participants: Number(r.participant_count ?? 0),
    hasTranscript: Boolean(r.has_transcript),
    hasSummary: Boolean(r.has_summary),
    actionItems: Number(r.action_item_count ?? 0),
  }));

  const caveats: string[] = [];

  if (!isOwner) {
    // The single most important thing a model can get wrong here: reading an empty or
    // short list as a statement about what meetings EXIST.
    caveats.push(
      'Scoped to meetings you attended, matched on your email address in the participant list. ' +
        'Meetings you were not part of are not counted here and their absence says nothing about whether they exist.',
    );
  }
  if (total > meetings.length) {
    caveats.push(
      `Showing the ${meetings.length} most recent of ${total} matching meetings. Narrow with since/until or search rather than assuming this is all of them.`,
    );
  }
  if (meetings.some((m) => !m.hasTranscript)) {
    const n = meetings.filter((m) => !m.hasTranscript).length;
    caveats.push(
      `${n} of these have no transcript stored, so any question about what was SAID in them cannot be answered from this system.`,
    );
  }

  return { meetings, matched: measure(total), caveats };
}

function formatDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

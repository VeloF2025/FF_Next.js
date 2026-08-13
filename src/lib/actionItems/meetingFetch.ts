/**
 * "Fetch this meeting, but only if the caller sat in it."
 *
 * Both manco routes that read meeting content need the same thing, and both had it
 * missing. Building the query here rather than inline in each handler means the gate can
 * be executed in a test instead of read off the page — a predicate that is never run is a
 * predicate whose parameter numbering and NULL behaviour are unverified.
 */

import { meetingAttendance, type ActionItemAccess } from './meetingAccess';

/**
 * Columns both callers need. `raw_transcript` and `summary` are the reason the gate
 * exists: one route returns verbatim excerpts of the transcript, the other copies them
 * into a comment thread.
 */
const COLUMNS = 'id, title, meeting_date, raw_transcript, summary';

export interface MeetingContentRow {
  id: number;
  title: string | null;
  meeting_date: string | null;
  raw_transcript: string | null;
  summary: {
    overview?: string;
    decisions?: string[];
    action_items?: string[];
  } | null;
}

export function meetingForCaller(
  meetingId: number,
  access: ActionItemAccess,
): { text: string; params: unknown[] } {
  const params: unknown[] = [meetingId];
  return {
    text: `SELECT ${COLUMNS}
             FROM meetings m
            WHERE m.id = $1
              AND ${meetingAttendance(access, params, 'm')}`,
    params,
  };
}

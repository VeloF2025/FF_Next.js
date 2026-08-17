/**
 * Row-level queries behind the CSV exports.
 *
 * Each export mirrors the scope of the report it exports, not a looser one:
 *
 *   - action-items uses the SAME meetings-only attendance rule as
 *     /api/reporting/action-items, so the CSV and the aggregate describe the same rows.
 *     It deliberately does NOT use the wider browser rule from lib/actionItems/listQuery
 *     (which also grants by assignment and to items with no meeting) — that rule belongs
 *     to the UI, and an export that quietly covered more than the report it came from
 *     would be a second, undocumented access surface.
 *   - meetings uses meetingAttendance, as /api/reporting/meetings does.
 *
 * The aggregate routes cap at 25 and 50 rows because they are summaries. A CSV exists to
 * carry the rows, so it caps far higher — but it still caps, and the route says so in the
 * response when it truncates.
 */

import { actionItemVisibility, meetingAttendance, type ActionItemAccess } from '@/lib/actionItems/meetingAccess';
import type { CsvColumn } from './csv';

/** Bulk, but bounded. ~5k rows of transcript text is a few MB, which a browser handles. */
export const EXPORT_MAX_ROWS = 5000;

export interface ActionItemExportRow {
  id: string;
  description: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  status: string | null;
  priority: string | null;
  due_date: Date | null;
  completed_date: Date | null;
  created_at: Date | null;
  source_type: string | null;
  meeting_id: number | null;
  meeting_title: string | null;
  meeting_date: Date | null;
}

export interface MeetingExportRow {
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

/** SAST, matching how /api/reporting/meetings filters and renders. */
const SAST = (col: string) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg')`;

export function actionItemExportQuery(
  access: ActionItemAccess,
  state: string,
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = [actionItemVisibility(access, params, 'a', { meetingsOnly: true })];

  // COALESCE, not a bare comparison: status is nullable and `<> 'completed'` is
  // NULL-inert, so an item with no status would vanish from the open export entirely.
  if (state === 'open') where.push(`COALESCE(a.status, 'pending') <> 'completed'`);
  if (state === 'completed') where.push(`a.status = 'completed'`);

  return {
    text: `
      SELECT a.id::text, a.description, a.assignee_name, a.assignee_email,
             a.status::text, a.priority::text,
             -- Every timestamp in SAST. Rendering meeting_date in SAST while leaving the
             -- rest in UTC put two timezones in one spreadsheet, and dated anything
             -- created after 22:00 UTC to the previous day.
             ${SAST('a.due_date')} AS due_date,
             ${SAST('a.completed_date')} AS completed_date,
             ${SAST('a.created_at')} AS created_at,
             a.source_type, a.meeting_id,
             m.title AS meeting_title,
             ${SAST('m.meeting_date')} AS meeting_date
        FROM action_items a
        LEFT JOIN meetings m ON m.id = a.meeting_id
       WHERE ${where.join('\n         AND ')}
       ORDER BY a.created_at DESC
       LIMIT ${EXPORT_MAX_ROWS + 1}`,
    params,
  };
}

export function meetingExportQuery(
  access: ActionItemAccess,
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  return {
    text: `
      SELECT m.id, m.title, ${SAST('m.meeting_date')} AS meeting_date, m.duration, m.source,
             jsonb_array_length(COALESCE(m.participants, '[]'::jsonb)) AS participant_count,
             (m.raw_transcript IS NOT NULL
               OR m.transcript_url IS NOT NULL
               OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = m.id))
               AS has_transcript,
             (m.summary IS NOT NULL AND jsonb_typeof(m.summary) <> 'null') AS has_summary,
             (SELECT count(*) FROM action_items a WHERE a.meeting_id = m.id)::int
               AS action_item_count
        FROM meetings m
       WHERE ${meetingAttendance(access, params, 'm')}
       ORDER BY m.meeting_date DESC NULLS LAST
       LIMIT ${EXPORT_MAX_ROWS + 1}`,
    params,
  };
}

/** Dates as plain `YYYY-MM-DD`, so a spreadsheet reads them as dates rather than text. */
function day(value: Date | null): string {
  if (!value) return '';
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const ACTION_ITEM_COLUMNS: readonly CsvColumn<ActionItemExportRow>[] = [
  { header: 'Description', value: (r) => r.description },
  { header: 'Assignee', value: (r) => r.assignee_name },
  { header: 'Assignee email', value: (r) => r.assignee_email },
  { header: 'Status', value: (r) => r.status },
  { header: 'Priority', value: (r) => r.priority },
  { header: 'Due date', value: (r) => day(r.due_date) },
  { header: 'Completed date', value: (r) => day(r.completed_date) },
  { header: 'Raised', value: (r) => day(r.created_at) },
  { header: 'Source', value: (r) => r.source_type },
  { header: 'Meeting', value: (r) => r.meeting_title },
  { header: 'Meeting date', value: (r) => day(r.meeting_date) },
];

export const MEETING_COLUMNS: readonly CsvColumn<MeetingExportRow>[] = [
  { header: 'Meeting', value: (r) => r.title },
  { header: 'Date', value: (r) => day(r.meeting_date) },
  { header: 'Duration (min)', value: (r) => r.duration },
  { header: 'Source', value: (r) => r.source },
  { header: 'Participants', value: (r) => r.participant_count },
  { header: 'Transcript captured', value: (r) => (r.has_transcript ? 'yes' : 'no') },
  { header: 'Summary captured', value: (r) => (r.has_summary ? 'yes' : 'no') },
  { header: 'Action items', value: (r) => r.action_item_count },
];


/**
 * Count the rows an export WOULD return, under the same gate.
 *
 * Used at mint time so the response can say how many rows are coming and whether the cap
 * will bite. Without it the only truncation signal was a response header on the CSV
 * itself, which neither a browser download nor an MCP client ever sees — so the caller
 * was told "5,000 rows" by a file that was actually the first 5,000 of 5,235.
 */
export function exportCountQuery(
  report: 'action-items' | 'meetings',
  access: ActionItemAccess,
  state: string,
): { text: string; params: unknown[] } {
  const params: unknown[] = [];

  if (report === 'meetings') {
    return {
      text: `SELECT count(*)::int AS n FROM meetings m
              WHERE ${meetingAttendance(access, params, 'm')}`,
      params,
    };
  }

  const where: string[] = [actionItemVisibility(access, params, 'a', { meetingsOnly: true })];
  if (state === 'open') where.push(`COALESCE(a.status, 'pending') <> 'completed'`);
  if (state === 'completed') where.push(`a.status = 'completed'`);

  return {
    text: `SELECT count(*)::int AS n FROM action_items a
            WHERE ${where.join('\n              AND ')}`,
    params,
  };
}

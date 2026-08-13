/**
 * The action-item list query.
 *
 * Extracted from the route so the generated SQL can be executed in a test rather than only
 * inspected. A visibility filter that is never run against a real database is a filter
 * whose parameter numbering, alias scoping and NULL behaviour are all unverified — and
 * those are exactly where an access check fails silently rather than loudly.
 */

import { actionItemVisibility, type ActionItemAccess } from './meetingAccess';

export interface ActionItemListFilters {
  status?: string;
  assignee_name?: string;
  meeting_id?: string;
  project_id?: string;
  priority?: string;
  search?: string;
  overdue?: string;
  assigned_to_user_id?: string;
  source_type?: string;
}

const SELECT_LIST = `
    ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
    ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
    ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
    ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
    m.title as meeting_title, m.meeting_date, m.transcript_url,
    u.first_name || ' ' || u.last_name as assigned_user_name,
    u.profile_picture as assigned_user_avatar`;

const ORDER_BY = `
  ORDER BY
    CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
         WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
    ai.created_at DESC`;

export const MAX_ROWS = 100;

/** Escape LIKE metacharacters so a user searching for "50%" does not match every row. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type BuiltQuery = { text: string; params: unknown[] } | { error: string };

export function buildActionItemListQuery(
  filters: ActionItemListFilters,
  access: ActionItemAccess,
): BuiltQuery {
  const params: unknown[] = [];
  const push = (value: unknown) => `$${params.push(value)}`;

  // The visibility predicate is FIRST and unconditional. Every clause below only narrows
  // further, so no combination of query parameters can widen what comes back.
  const where: string[] = [actionItemVisibility(access, params)];

  if (filters.meeting_id) {
    const meetingId = Number.parseInt(filters.meeting_id, 10);
    // A non-numeric meeting_id used to become NaN and get dropped, widening the result to
    // every meeting. Reject it instead of quietly ignoring it.
    if (!Number.isFinite(meetingId)) return { error: 'meeting_id must be a number' };
    where.push(`ai.meeting_id = ${push(meetingId)}`);
  }
  if (filters.project_id) where.push(`ai.project_id = ${push(filters.project_id)}::uuid`);
  if (filters.assigned_to_user_id) {
    where.push(`ai.assigned_to_user_id = ${push(filters.assigned_to_user_id)}::uuid`);
  }
  if (filters.source_type) where.push(`ai.source_type = ${push(filters.source_type)}`);
  // ::text on both sides: status and priority are enums, so binding an unknown value
  // directly would raise "invalid input value for enum" — a 500 from a user-supplied string.
  if (filters.priority) where.push(`ai.priority::text = ${push(filters.priority)}`);
  if (filters.status) {
    where.push(
      `ai.status::text = ANY(${push(filters.status.split(',').map((s) => s.trim()))})`,
    );
  }
  if (filters.assignee_name) {
    where.push(`ai.assignee_name ILIKE ${push(`%${likeLiteral(filters.assignee_name)}%`)}`);
  }
  if (filters.search) {
    where.push(`ai.description ILIKE ${push(`%${likeLiteral(filters.search)}%`)}`);
  }
  if (filters.overdue === 'true') {
    where.push(`(ai.due_date < NOW() AND ai.status::text <> 'completed')`);
  }

  // Filters run in SQL. The previous shape fetched 500 rows, filtered them in JavaScript
  // and sliced to 100 — so a filter only ever saw an arbitrary 500-row window and matching
  // rows outside it were reported as absent.
  const text = `
    SELECT ${SELECT_LIST}
    FROM action_items ai
    LEFT JOIN meetings m ON ai.meeting_id = m.id
    LEFT JOIN users u ON ai.assigned_to_user_id = u.id
    WHERE ${where.join('\n      AND ')}
    ${ORDER_BY}
    LIMIT ${MAX_ROWS}`;

  return { text, params };
}

/**
 * The action-item list query.
 *
 * Extracted from the route so the generated SQL can be executed in a test rather than only
 * inspected. A visibility filter that is never run against a real database is a filter
 * whose parameter numbering, alias scoping and NULL behaviour are all unverified — and
 * those are exactly where an access check fails silently rather than loudly.
 */

import { actionItemVisibility, type ActionItemAccess } from './meetingAccess';

/**
 * Raw query values as Next actually delivers them.
 *
 * A repeated parameter (`?status=a&status=b`) arrives as `string[]`, NOT `string`. Typing
 * these as `string` and casting `req.query` was a lie the runtime punished: `.split` and
 * `.replace` are not array methods, so `?status=a&status=b` threw a TypeError and became a
 * 500 with a log line, from a URL anyone can construct. Worse, `overdue` compared an array
 * against `'true'`, silently dropped the filter and returned the caller's whole backlog
 * instead of their overdue items.
 */
export interface ActionItemListFilters {
  status?: string | string[];
  assignee_name?: string | string[];
  meeting_id?: string | string[];
  project_id?: string | string[];
  priority?: string | string[];
  search?: string | string[];
  overdue?: string | string[];
  assigned_to_user_id?: string | string[];
  source_type?: string | string[];
}

/**
 * Collapse a repeated parameter to its first value.
 *
 * First rather than last, and never joined: taking one value keeps the filter narrowing.
 * Joining would build a search term no row matches, which reads to the caller as "nothing
 * found" rather than "your request was ambiguous".
 */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
  return value;
}

/** Strict positive-integer parse. `parseInt` prefix-parses, so '1abc' and '1 OR 1=1' both yield 1. */
function strictInt(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
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
  rawFilters: ActionItemListFilters,
  access: ActionItemAccess,
): BuiltQuery {
  const params: unknown[] = [];
  const push = (value: unknown) => `$${params.push(value)}`;

  // Normalise BEFORE any use. Every branch below assumes a plain string.
  const meeting_id = one(rawFilters.meeting_id);
  const project_id = one(rawFilters.project_id);
  const assigned_to_user_id = one(rawFilters.assigned_to_user_id);
  const source_type = one(rawFilters.source_type);
  const priority = one(rawFilters.priority);
  const status = one(rawFilters.status);
  const assignee_name = one(rawFilters.assignee_name);
  const search = one(rawFilters.search);
  const overdue = one(rawFilters.overdue);

  // The visibility predicate is FIRST and unconditional. Every clause below only narrows
  // further, so no combination of query parameters can widen what comes back.
  const where: string[] = [actionItemVisibility(access, params)];

  if (meeting_id) {
    // Strict, not Number.parseInt: prefix-parsing accepted '1abc', '1 OR 1=1' and '1.9' as
    // 1, so the filter silently answered a different question than the caller asked.
    const meetingId = strictInt(meeting_id);
    if (meetingId === null) return { error: 'meeting_id must be a number' };
    where.push(`ai.meeting_id = ${push(meetingId)}`);
  }
  if (project_id) where.push(`ai.project_id = ${push(project_id)}::uuid`);
  if (assigned_to_user_id) {
    where.push(`ai.assigned_to_user_id = ${push(assigned_to_user_id)}::uuid`);
  }
  if (source_type) where.push(`ai.source_type = ${push(source_type)}`);
  // ::text on both sides: status and priority are enums, so binding an unknown value
  // directly would raise "invalid input value for enum" — a 500 from a user-supplied string.
  if (priority) where.push(`ai.priority::text = ${push(priority)}`);
  if (status) {
    where.push(`ai.status::text = ANY(${push(status.split(',').map((s) => s.trim()))})`);
  }
  if (assignee_name) {
    where.push(`ai.assignee_name ILIKE ${push(`%${likeLiteral(assignee_name)}%`)}`);
  }
  if (search) {
    where.push(`ai.description ILIKE ${push(`%${likeLiteral(search)}%`)}`);
  }
  if (overdue === 'true') {
    // `due_date` is `timestamp without time zone`, so `< NOW()` resolves through the
    // session timezone. Moving this from JS `new Date(...)` into SQL therefore makes a
    // couple of hours' drift possible right at the day boundary. Left as-is deliberately:
    // stats.ts already computed `overdue` this way on master, so matching it keeps the
    // headline count and the list agreeing. Changing the basis is a separate decision
    // about the whole module, not a side effect of this gate.
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

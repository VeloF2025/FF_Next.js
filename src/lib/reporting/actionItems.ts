/**
 * The action-item backlog — and what it actually is.
 *
 * The headline count invites a wrong reading. There are ~5,000 pending items against
 * ~170 completed, which looks like thousands of dropped commitments. The dimensions say
 * otherwise:
 *
 *   source          4,884 of 5,047 are machine-extracted from meeting transcripts
 *                   ('transcript' 3,352, 'cortex-scribe' 1,532) — not commitments a
 *                   person typed and then ignored.
 *   project_id      populated on FIVE of 5,047. "Action items by project" cannot be
 *                   answered at all, so this module does not offer it.
 *   due_date        populated on 17. "Overdue" is computable for six items and is
 *                   meaningless as a backlog measure.
 *   assignee_name   4,582 populated — the one dimension that carries real signal.
 *
 * So the useful questions are "who is carrying what", "how stale is it", and "how fast
 * is extraction outrunning triage" — not "how far behind is the project".
 *
 * A machine-created item that nobody closed is not evidence of dropped work. It is
 * evidence of an extraction feed without a triage step, and the report says so rather
 * than presenting 5,047 as a to-do list.
 */
import { measure, type Measure } from './coverage';

/** Both spellings of "nobody owns this" — the column carries a literal and a NULL. */
const UNASSIGNED_SQL = `COALESCE(NULLIF(TRIM(a.assignee_name), ''), 'Unassigned')`;

export interface ActionItemFilter {
  assignee?: string;
  /** 'open' (default) | 'completed' | 'all' */
  state: 'open' | 'completed' | 'all';
  /** Only items older than this many days. */
  olderThanDays?: number;
  source?: string;
  limit: number;
}

export function parseActionFilter(query: Record<string, string | string[] | undefined>):
  | { filter: ActionItemFilter }
  | { error: string } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const state = (one(query.state) ?? 'open') as ActionItemFilter['state'];
  if (!['open', 'completed', 'all'].includes(state)) {
    return { error: `state must be open, completed or all — got "${state}"` };
  }

  const olderRaw = one(query.olderThanDays);
  let olderThanDays: number | undefined;
  if (olderRaw !== undefined && olderRaw !== '') {
    const n = Number(olderRaw);
    if (!Number.isInteger(n) || n < 0) {
      return { error: `olderThanDays must be a non-negative integer — got "${olderRaw}"` };
    }
    olderThanDays = n;
  }

  const limitRaw = Number(one(query.limit) ?? 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 25;

  return {
    filter: {
      assignee: one(query.assignee) || undefined,
      state,
      olderThanDays,
      source: one(query.source) || undefined,
      limit,
    },
  };
}

function push(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function actionItemsQuery(filter: ActionItemFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = ['1=1'];

  // COALESCE, not a bare comparison: `status` is nullable and `<> 'completed'` is
  // NULL-inert, so an item with no status would vanish from the open count entirely.
  if (filter.state === 'open') where.push(`COALESCE(a.status, 'pending') <> 'completed'`);
  if (filter.state === 'completed') where.push(`a.status = 'completed'`);

  if (filter.assignee) {
    where.push(`${UNASSIGNED_SQL} ILIKE ${push(params, `%${escapeLike(filter.assignee)}%`)}`);
  }
  if (filter.source) where.push(`a.source = ${push(params, filter.source)}`);
  if (filter.olderThanDays !== undefined) {
    where.push(`a.created_at < now() - (${push(params, filter.olderThanDays)}::int * interval '1 day')`);
  }

  const scope = where.join(' AND ');
  // One params array, pushed in the order the placeholders appear. The sample LIMIT is
  // pushed last because it is the last placeholder in the statement.
  const limitRef = push(params, filter.limit);

  return {
    params,
    sql: `
      WITH scoped AS (
        SELECT a.id, a.description, a.status, a.created_at, a.completed_date,
               a.source, a.meeting_id, a.due_date,
               ${UNASSIGNED_SQL} AS assignee
        FROM action_items a
        WHERE ${scope}
      ),
      totals AS (
        SELECT count(*)::bigint AS matched,
               count(*) FILTER (WHERE assignee = 'Unassigned')::bigint AS unassigned,
               count(*) FILTER (WHERE created_at < now() - interval '30 days')::bigint AS over_30d,
               count(*) FILTER (WHERE created_at < now() - interval '90 days')::bigint AS over_90d,
               count(DISTINCT assignee)::bigint AS distinct_assignees,
               min(created_at) AS oldest
        FROM scoped
      ),
      -- Extraction versus triage over the same window. This is the number that says what
      -- the backlog IS: items arrive from transcript extraction far faster than anyone
      -- closes them, which is a pipeline shape, not a delivery failure.
      flow AS (
        SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days')::bigint AS created_30d,
               count(*) FILTER (WHERE status = 'completed'
                                  AND completed_date > now() - interval '30 days')::bigint AS completed_30d
        FROM action_items a
      ),
      by_assignee AS (
        SELECT assignee, count(*)::bigint AS n,
               count(*) FILTER (WHERE created_at < now() - interval '90 days')::bigint AS stale
        FROM scoped GROUP BY 1 ORDER BY 2 DESC LIMIT 12
      ),
      by_source AS (
        SELECT COALESCE(source, 'unrecorded') AS source, count(*)::bigint AS n
        FROM scoped GROUP BY 1 ORDER BY 2 DESC
      ),
      sample AS (
        SELECT id::text, description, assignee, source,
               created_at, meeting_id::text
        FROM scoped ORDER BY created_at ASC LIMIT ${limitRef}
      )
      SELECT totals.matched, totals.unassigned, totals.over_30d, totals.over_90d,
             totals.distinct_assignees, totals.oldest,
             flow.created_30d, flow.completed_30d,
             (SELECT json_agg(json_build_object('assignee', assignee, 'open', n, 'olderThan90Days', stale)
                ORDER BY n DESC) FROM by_assignee) AS by_assignee,
             (SELECT json_agg(json_build_object('source', source, 'count', n) ORDER BY n DESC)
                FROM by_source) AS by_source,
             (SELECT json_agg(json_build_object('id', id, 'description', description,
                'assignee', assignee, 'source', source, 'createdAt', created_at,
                'meetingId', meeting_id) ORDER BY created_at ASC) FROM sample) AS oldest_items
      FROM totals, flow`,
  };
}

export interface ActionItemsRow {
  matched: string;
  unassigned: string;
  over_30d: string;
  over_90d: string;
  distinct_assignees: string;
  oldest: string | null;
  created_30d: string;
  completed_30d: string;
  by_assignee: Array<{ assignee: string; open: string | number; olderThan90Days: string | number }> | null;
  by_source: Array<{ source: string; count: string | number }> | null;
  oldest_items: Array<Record<string, unknown>> | null;
}

export interface ActionItemsReport {
  matched: Measure;
  unassigned: Measure;
  olderThan30Days: Measure;
  olderThan90Days: Measure;
  oldestOpenedAt: string | null;
  flow: { createdLast30Days: number; completedLast30Days: number; ratio: number | null; note: string };
  byAssignee: Array<{ assignee: string; open: number; olderThan90Days: number }>;
  bySource: Array<{ source: string; count: number }>;
  oldestItems: Array<Record<string, unknown>>;
  caveats: string[];
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

export function shapeActionItems(
  row: ActionItemsRow,
  filteredByAssignee = false,
): ActionItemsReport {
  const matched = n(row.matched);
  const created = n(row.created_30d);
  const completed = n(row.completed_30d);
  const bySource = (row.by_source ?? []).map((s) => ({ source: s.source, count: n(s.count) }));
  const machineSources = bySource
    .filter((s) => s.source === 'transcript' || s.source === 'cortex-scribe')
    .reduce((a, b) => a + b.count, 0);

  const caveats: string[] = [];

  if (machineSources > 0 && matched > 0) {
    const pct = Math.round((machineSources / matched) * 100);
    caveats.push(
      `${pct}% of these were extracted automatically from meeting transcripts, not entered by a person. ` +
        'An open machine-extracted item is an untriaged suggestion, not a dropped commitment — do not present this count as work someone promised and failed to do.',
    );
  }
  caveats.push(
    'Not filterable by project: project_id is populated on a handful of rows out of thousands. ' +
      'Due dates are almost entirely absent too, so "overdue" cannot be computed meaningfully.',
  );
  // Assignee is free text, and the same person genuinely appears under several
  // spellings: "Lew Hofmeyr", "Lew Hofmeyr - Velo", "Lew", "Llewellyn" and
  // "Llewelyn Hofmeyr" are all one person in this data. Any per-person total is
  // therefore a floor, not a count, and the top-assignee list understates whoever is
  // most fragmented.
  const spellings = n(row.distinct_assignees);
  if (filteredByAssignee && spellings > 1) {
    caveats.push(
      `That name matched ${spellings} different spellings of the assignee field, which is free text. ` +
        'The totals below combine them, but anyone NOT matching your search string is still excluded — treat a per-person figure as a floor.',
    );
  } else if (!filteredByAssignee) {
    caveats.push(
      'Assignee is free text and the same person appears under several spellings, so the ' +
        'per-person breakdown splits some people across rows and understates them.',
    );
  }
  if (n(row.unassigned) > 0) {
    caveats.push(
      `${row.unassigned} have no assignee, so they belong to nobody and will not be cleared by anyone reading their own list.`,
    );
  }

  const ratio = completed > 0 ? Math.round((created / completed) * 10) / 10 : null;

  return {
    matched: measure(matched),
    unassigned: measure(n(row.unassigned)),
    olderThan30Days: measure(n(row.over_30d)),
    olderThan90Days: measure(n(row.over_90d)),
    oldestOpenedAt: row.oldest,
    flow: {
      createdLast30Days: created,
      completedLast30Days: completed,
      ratio,
      note:
        ratio === null
          ? `${created} created in the last 30 days and none recorded as completed, so no clearance rate can be computed.`
          : `${created} created against ${completed} completed in the last 30 days — arriving about ${ratio}x faster than they are closed. Read that as the shape of the pipeline, not as a measure of anyone's delivery.`,
    },
    byAssignee: (row.by_assignee ?? []).map((a) => ({
      assignee: a.assignee,
      open: n(a.open),
      olderThan90Days: n(a.olderThan90Days),
    })),
    bySource,
    oldestItems: row.oldest_items ?? [],
    caveats,
  };
}

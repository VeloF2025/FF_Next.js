/**
 * Ordering, cursors, and per-source bounds for the incident chronology — the
 * paging half of `timelineService.ts`, which merges and labels.
 *
 * It is one file because the three are one decision. The order entries are
 * merged in, the position a cursor encodes, and the predicate each source is
 * read with have to agree exactly; when they drift apart the chronology does not
 * fail loudly, it quietly stops part-way through a history nobody is watching.
 * Keeping them apart from the merge is what makes that agreement reviewable in
 * one screen.
 */
import type { IncidentTimelineEntry } from './types';
import type { TimelineBound } from './timelineQueries';

export class IncidentTimelineCursorError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTimelineCursorError'; }
}

/**
 * The five tables the chronology merges, in the order they break a tie on the
 * same instant. It is the source *table* that ranks, not the `TimelineSource`
 * label an entry is displayed with: one table (`actions`) produces manager,
 * driver, and system entries, so the label cannot identify which keyset a
 * cursor belongs to. The order itself is arbitrary but must never change — it
 * is half of the sort key a cursor is a position in.
 */
const TIMELINE_TABLES = ['actions', 'observations', 'attendance', 'notifications', 'retention_holds'] as const;
export type TimelineTable = typeof TIMELINE_TABLES[number];
const TABLE_RANK: Record<TimelineTable, number> = {
  actions: 0, observations: 1, attendance: 2, notifications: 3, retention_holds: 4,
};

/**
 * An entry plus where it sits in the merged order. `sortId` is the value the
 * source's own keyset compares — a row id everywhere except notifications,
 * whose minute bucket is its identity — and it is kept beside the entry rather
 * than parsed back out of `stableId`, which is a display value.
 */
export interface PositionedEntry {
  table: TimelineTable;
  /**
   * The row's `sort_at` text, exactly as the database rendered it. Never
   * `entry.occurredAt`: that has been through a `Date` and has lost the
   * microseconds the cursor needs to land between two rows.
   */
  sortAt: string;
  sortId: string;
  entry: IncidentTimelineEntry;
}

/**
 * The merged order, and the exact order every source keyset reproduces:
 * instant, then table, then the source's own id. The instant compared is
 * `sortAt` — full-precision fixed-width UTC text, which orders lexicographically
 * exactly as it orders chronologically — and never the displayed `occurredAt`,
 * which is a millisecond rounding of it. `recordedAt` is deliberately not part
 * of the order either: it is a second timestamp the entry reports, not a
 * position, and no source can bound a read on another source's `recordedAt`.
 */
export function comparePositions(left: PositionedEntry, right: PositionedEntry): number {
  if (left.sortAt !== right.sortAt) return left.sortAt < right.sortAt ? -1 : 1;
  if (left.table !== right.table) return TABLE_RANK[left.table] - TABLE_RANK[right.table];
  if (left.sortId === right.sortId) return 0;
  return left.sortId < right.sortId ? -1 : 1;
}

interface TimelinePosition { sortAt: string; table: TimelineTable; sortId: string }

/** Tables whose `sortId` is a row id; `notifications` keys on its minute bucket instead. */
const UUID_KEYED: ReadonlySet<TimelineTable> = new Set<TimelineTable>([
  'actions', 'observations', 'attendance', 'retention_holds',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Exactly what `SORT_KEY` in `timelineQueries.ts` emits, and nothing else.
 * `Date.parse` is not a substitute: it accepts `2026` and `2026-08-24 (x)`,
 * which a `::timestamptz` cast rejects as 22007 — the same malformed-request
 * reaching the database as a logged 500 that validating the id was meant to
 * stop. A cursor field is machine-written, so the only shape worth accepting is
 * the one we write.
 */
const SORT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(last: PositionedEntry): string {
  return Buffer.from(`${last.sortAt}|${last.table}|${last.sortId}`, 'utf8').toString('base64url');
}

/**
 * A cursor is a position, not a token to be trusted: it is decoded back into the
 * same three ordering fields, and anything that is not one of them is refused
 * rather than defaulted. A tampered cursor can only move the window, never widen
 * what the query returns.
 *
 * Both timestamps and the id are validated to the exact shape they are written
 * in, because they reach the database as `$2::timestamptz`, `$3::uuid`, or
 * `$3::timestamptz`. Anything a cast would refuse has to be refused here first:
 * a cursor that decodes but carries rubbish is otherwise a 22P02 or a 22007,
 * surfacing as a logged 500 for what is a malformed request the caller should be
 * told about with a 400.
 */
export function decodeCursor(cursor: string): TimelinePosition {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const [sortAt, table, sortId] = parts;
  if (parts.length !== 3 || !sortAt || !table || !sortId
    || !TIMELINE_TABLES.includes(table as TimelineTable) || !SORT_AT.test(sortAt)) {
    throw new IncidentTimelineCursorError('The timeline cursor could not be read');
  }
  const keyed = table as TimelineTable;
  const usable = UUID_KEYED.has(keyed) ? UUID.test(sortId) : SORT_AT.test(sortId);
  if (!usable) throw new IncidentTimelineCursorError('The timeline cursor could not be read');
  return { sortAt, table: keyed, sortId };
}

/**
 * The bound one source is read with. Rows sharing the cursor's instant are the
 * whole difficulty: they sort after the cursor only if their table ranks after
 * the cursor's, and within the cursor's own table only if their id does. A
 * source ranked before the cursor's takes none of them.
 */
export function boundFor(table: TimelineTable, after: TimelinePosition | null, limit: number): TimelineBound {
  if (!after) return { after: null, afterId: null, includeAtInstant: false, limit };
  const rank = TABLE_RANK[table] - TABLE_RANK[after.table];
  return {
    after: after.sortAt,
    afterId: rank === 0 ? after.sortId : null,
    includeAtInstant: rank >= 0,
    limit,
  };
}

/**
 * Validation lives on the route, which answers 400 rather than silently
 * clamping (`parseLimit` in `pages/api/fleet/incidents/[incidentId]/timeline.ts`).
 * This is the defence for a direct caller only, and it deliberately does not
 * clamp either: a limit this function cannot honour falls back to the default
 * rather than being quietly reshaped into a different number of rows, so no
 * caller can be answered a page size the route would have rejected.
 */

/**
 * Scoped incident chronology (stage 8, task 6): one ordered view of what
 * happened to an incident, merged in memory from the PR4-7 tables.
 *
 * Three rules the tests hold this file to:
 *
 * 1. **No free text ever reaches an entry.** Every `summary` is either a label
 *    from a map keyed on a CHECK-constrained enum or a label with a count
 *    interpolated into it — never a value a person typed. A manager's comment, a
 *    driver's explanation, and an evidence filename therefore cannot be carried
 *    out of the drawer by a timeline read. The bodies are already rendered by
 *    the drawer's own sections to viewers permitted to read them.
 * 2. **Nothing is rewritten after the fact.** An entry reports the event as it
 *    was recorded. Where a source later changes state — an Attendance
 *    correction being approved, say — the chronology does not go back and
 *    restate the earlier entry.
 * 3. **A recorded time is never invented.** Only observations record when the
 *    system found out separately from when the thing happened; for every other
 *    source `recordedAt` equals `occurredAt` rather than a fabricated stand-in.
 */
import { IncidentNotFoundError } from '../incidentRepository';
import { getIncidentCore } from '../reviewQueries';
import { isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';
import { resolveActiveUserNames } from '../settingsRepository';
import type { IncidentActionType } from '../types';
import type { RetentionHoldActionType } from './aggregateSchema';
import {
  listActionSource, listAttendanceSource, listNotificationSource,
  listObservationSource, listRetentionHoldSource, type TimelineBound,
} from './timelineQueries';
import type { IncidentTimelineEntry, IncidentTimelinePage, TimelineSource } from './types';

/**
 * Defined here rather than reused from `reviewService.ts` on purpose: importing
 * that module would pull the whole transition/notification graph in behind one
 * error class, and this read needs none of it.
 */
export class IncidentTimelineAccessDeniedError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTimelineAccessDeniedError'; }
}

export class IncidentTimelineCursorError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTimelineCursorError'; }
}

export interface IncidentTimelineViewer {
  userId: string;
  staffId: string | null;
  role: string;
}

export interface IncidentTimelineOptions {
  limit?: number;
  cursor?: string | null;
}

export const TIMELINE_DEFAULT_LIMIT = 100;
export const TIMELINE_MAX_LIMIT = 200;

const ACTION_SUMMARIES: Record<IncidentActionType, string> = {
  opened: 'Incident opened',
  acknowledged: 'Acknowledged',
  review_started: 'Review started',
  commented: 'Comment added',
  escalated: 'Escalated',
  condition_cleared: 'Condition cleared',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  evidence_added: 'Evidence added',
  recipient_changed: 'Notification list changed',
  driver_input_requested: 'Driver input requested',
  driver_response_received: 'Driver responded',
};

const HOLD_SUMMARIES: Record<RetentionHoldActionType, string> = {
  created: 'Retention hold created',
  reviewed: 'Retention hold reviewed',
  extended: 'Retention hold extended',
  released: 'Retention hold released',
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
type TimelineTable = typeof TIMELINE_TABLES[number];
const TABLE_RANK: Record<TimelineTable, number> = {
  actions: 0, observations: 1, attendance: 2, notifications: 3, retention_holds: 4,
};

/**
 * An entry plus where it sits in the merged order. `sortId` is the value the
 * source's own keyset compares — a row id everywhere except notifications,
 * whose minute bucket is its identity — and it is kept beside the entry rather
 * than parsed back out of `stableId`, which is a display value.
 */
interface PositionedEntry {
  table: TimelineTable;
  sortId: string;
  entry: IncidentTimelineEntry;
}

function entry(
  table: TimelineTable, source: TimelineSource, id: string, entryType: string,
  occurredAt: string, recordedAt: string, summary: string, actorLabel: string | null,
): PositionedEntry {
  return {
    table,
    sortId: id,
    entry: { stableId: `${source}:${id}`, source, entryType, occurredAt, recordedAt, summary, actorLabel },
  };
}

/**
 * An action's source is read off the row, not off the action type: a manager and
 * a driver both write to this table, and `visibility = 'driver_submitted'` is
 * what `driver/submissionService.ts` stamps on the driver's own rows. Checked
 * before `is_system_actor` so a driver row can never be relabelled `system`.
 */
function actionSource(row: { is_system_actor: boolean; visibility: string }): TimelineSource {
  if (row.visibility === 'driver_submitted') return 'driver';
  return row.is_system_actor ? 'system' : 'manager';
}

/**
 * The merged order, and the exact order every source keyset reproduces:
 * instant, then table, then the source's own id. `recordedAt` is deliberately
 * not part of it — it is a second timestamp the entry reports, not a position,
 * and no source can bound a read on another source's `recordedAt`.
 */
function comparePositions(left: PositionedEntry, right: PositionedEntry): number {
  if (left.entry.occurredAt !== right.entry.occurredAt) {
    return left.entry.occurredAt < right.entry.occurredAt ? -1 : 1;
  }
  if (left.table !== right.table) return TABLE_RANK[left.table] - TABLE_RANK[right.table];
  if (left.sortId === right.sortId) return 0;
  return left.sortId < right.sortId ? -1 : 1;
}

interface TimelinePosition { occurredAt: string; table: TimelineTable; sortId: string }

function encodeCursor(last: PositionedEntry): string {
  return Buffer.from(`${last.entry.occurredAt}|${last.table}|${last.sortId}`, 'utf8').toString('base64url');
}

/**
 * A cursor is a position, not a token to be trusted: it is decoded back into the
 * same three ordering fields, and an unknown table or an unparseable instant is
 * refused rather than defaulted. A tampered cursor can only move the window,
 * never widen what the query returns.
 */
function decodeCursor(cursor: string): TimelinePosition {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const [occurredAt, table, sortId] = parts;
  if (parts.length !== 3 || !occurredAt || !table || !sortId
    || !TIMELINE_TABLES.includes(table as TimelineTable) || Number.isNaN(Date.parse(occurredAt))) {
    throw new IncidentTimelineCursorError('The timeline cursor could not be read');
  }
  return { occurredAt, table: table as TimelineTable, sortId };
}

/**
 * The bound one source is read with. Rows sharing the cursor's instant are the
 * whole difficulty: they sort after the cursor only if their table ranks after
 * the cursor's, and within the cursor's own table only if their id does. A
 * source ranked before the cursor's takes none of them.
 */
function boundFor(table: TimelineTable, after: TimelinePosition | null, limit: number): TimelineBound {
  if (!after) return { after: null, afterId: null, includeAtInstant: false, limit };
  const rank = TABLE_RANK[table] - TABLE_RANK[after.table];
  return {
    after: after.occurredAt,
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
function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return TIMELINE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX_LIMIT) return TIMELINE_DEFAULT_LIMIT;
  return limit;
}

/**
 * Names come from the active-user directory and nowhere else. When a user cannot
 * be named — deactivated, or never a FibreFlow user in the first place — the
 * label is `null` rather than the raw id: a UUID identifies a person just as
 * well as a name does, while telling the reader nothing.
 */
async function resolveActorLabels(userIds: (string | null)[]): Promise<Map<string, string>> {
  const distinct = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (distinct.length === 0) return new Map();
  const named = await resolveActiveUserNames(distinct);
  return new Map(named.map((option) => [option.id, option.name]));
}

export async function getIncidentTimeline(
  incidentId: string, viewer: IncidentTimelineViewer, options: IncidentTimelineOptions = {},
): Promise<IncidentTimelinePage> {
  // The same gate `reviewService.ts#getIncidentDetailForViewer` applies, in the
  // same order — resolved once here, so no source read below repeats it.
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'view');
  if (!scope) throw new IncidentTimelineAccessDeniedError('You cannot view Fleet incidents');
  const core = await getIncidentCore(incidentId);
  // Missing answers 404 and out-of-scope answers 403 — the same pair, in the
  // same order, as the detail read this chronology is rendered beside
  // (`reviewService.ts#getIncidentDetailForViewer`). Answering 404 here instead
  // would not hide anything: a manager who can see the incident's detail can
  // already tell the two apart from that endpoint, so the only thing a
  // divergence buys is two endpoints disagreeing about the same incident.
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  if (!scope.unrestricted && !await isProjectOwnedByScope(scope, core.projectId)) {
    throw new IncidentTimelineAccessDeniedError('You cannot view this Fleet incident');
  }

  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const limit = resolveLimit(options.limit);
  // One row past the page is what tells `nextCursor` there is another page. Read
  // it from every source, because any of them could own that row.
  const bound = (table: TimelineTable): TimelineBound => boundFor(table, after, limit + 1);

  const [actions, observations, attendance, notifications, holds] = await Promise.all([
    listActionSource(incidentId, bound('actions')),
    listObservationSource(incidentId, bound('observations')),
    listAttendanceSource(incidentId, bound('attendance')),
    listNotificationSource(incidentId, bound('notifications')),
    listRetentionHoldSource(incidentId, bound('retention_holds')),
  ]);

  const labels = await resolveActorLabels([
    ...actions.map((row) => row.actor_user_id), ...holds.map((row) => row.actor_user_id),
  ]);
  const labelFor = (userId: string | null): string | null => (userId ? labels.get(userId) ?? null : null);

  const merged: PositionedEntry[] = [
    ...actions.map((row) => {
      const at = iso(row.occurred_at);
      return entry('actions', actionSource(row), row.id, row.action_type, at, at,
        ACTION_SUMMARIES[row.action_type] ?? 'Incident updated', labelFor(row.actor_user_id));
    }),
    ...observations.map((row) => entry(
      'observations', 'system', row.id, 'observation_recorded', iso(row.observed_at), iso(row.recorded_at),
      'Condition observed', null,
    )),
    ...attendance.map((row) => {
      const at = iso(row.linked_at);
      return entry('attendance', 'attendance', row.id, 'correction_linked', at, at,
        'Attendance correction linked', null);
    }),
    // The count is a number the database computed, not text anyone typed, and it
    // is the point of the entry: a manager reading the chronology needs to know
    // that a notification went out and how far it reached. What the minute
    // grouping protects is *who* was notified — `user_notifications.user_id` is
    // never read, so the audience can be sized but not named.
    ...notifications.map((row) => {
      const at = iso(row.occurred_at);
      return entry('notifications', 'notification', at, 'notification_delivered', at, at,
        `Notified ${row.recipient_count} recipients`, null);
    }),
    ...holds.map((row) => {
      const at = iso(row.occurred_at);
      return entry('retention_holds', 'retention_hold', row.id, `retention_hold_${row.action_type}`, at, at,
        HOLD_SUMMARIES[row.action_type] ?? 'Retention hold updated', labelFor(row.actor_user_id));
    }),
  ].sort(comparePositions);

  // No second cursor filter here on purpose. Every source was read strictly past
  // the cursor, so a row that reached this point belongs on this page; filtering
  // again would only be able to hide a keyset that had stopped working.
  const page = merged.slice(0, limit);
  const nextCursor = merged.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;
  return { entries: page.map((positioned) => positioned.entry), nextCursor };
}

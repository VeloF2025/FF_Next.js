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
import {
  boundFor, comparePositions, decodeCursor, encodeCursor,
  type PositionedEntry, type TimelineTable,
} from './timelineCursor';
import type { IncidentTimelineEntry, IncidentTimelinePage, TimelineSource } from './types';

/**
 * Defined here rather than reused from `reviewService.ts` on purpose: importing
 * that module would pull the whole transition/notification graph in behind one
 * error class, and this read needs none of it.
 */
export class IncidentTimelineAccessDeniedError extends Error {
  constructor(message: string) { super(message); this.name = 'IncidentTimelineAccessDeniedError'; }
}

export { IncidentTimelineCursorError } from './timelineCursor';

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

function entry(
  table: TimelineTable, source: TimelineSource, id: string, sortAt: string, entryType: string,
  occurredAt: string, recordedAt: string, summary: string, actorLabel: string | null,
): PositionedEntry {
  return {
    table,
    sortAt,
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
      return entry('actions', actionSource(row), row.id, row.sort_at, row.action_type, at, at,
        ACTION_SUMMARIES[row.action_type] ?? 'Incident updated', labelFor(row.actor_user_id));
    }),
    ...observations.map((row) => entry(
      'observations', 'system', row.id, row.sort_at, 'observation_recorded',
      iso(row.observed_at), iso(row.recorded_at), 'Condition observed', null,
    )),
    ...attendance.map((row) => {
      const at = iso(row.linked_at);
      return entry('attendance', 'attendance', row.id, row.sort_at, 'correction_linked', at, at,
        'Attendance correction linked', null);
    }),
    // The count is a number the database computed, not text anyone typed, and it
    // is the point of the entry: a manager reading the chronology needs to know
    // that a notification went out and how far it reached. What the minute
    // grouping protects is *who* was notified — `user_notifications.user_id` is
    // never read, so the audience can be sized but not named.
    ...notifications.map((row) => {
      const at = iso(row.occurred_at);
      return entry('notifications', 'notification', row.sort_at, row.sort_at, 'notification_delivered',
        at, at, `Notified ${row.recipient_count} recipients`, null);
    }),
    ...holds.map((row) => {
      const at = iso(row.occurred_at);
      return entry('retention_holds', 'retention_hold', row.id, row.sort_at,
        `retention_hold_${row.action_type}`, at, at,
        HOLD_SUMMARIES[row.action_type] ?? 'Retention hold updated', labelFor(row.actor_user_id));
    }),
  ].sort(comparePositions);

  // No second cursor filter here on purpose. Every source was read strictly past
  // the cursor, so a row that reached this point belongs on this page; filtering
  // again would only be able to hide a keyset that had stopped working.
  const page = merged.slice(0, limit);
  // `merged.length > limit` already means the slice is full, so there is always
  // a last entry to encode; a further emptiness check here would be unreachable.
  const nextCursor = merged.length > limit ? encodeCursor(page[page.length - 1]!) : null;
  return { entries: page.map((positioned) => positioned.entry), nextCursor };
}

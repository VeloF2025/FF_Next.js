/**
 * Scoped incident chronology (stage 8, task 6): one ordered view of what
 * happened to an incident, merged in memory from the PR4-7 tables.
 *
 * Three rules the tests hold this file to:
 *
 * 1. **No free text ever reaches an entry.** Every `summary` comes from a label
 *    map keyed on a CHECK-constrained enum, so a manager's comment, a driver's
 *    explanation, and an evidence filename cannot be carried out of the drawer
 *    by a timeline read. The bodies are already rendered by the drawer's own
 *    sections to viewers permitted to read them.
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
  listObservationSource, listRetentionHoldSource,
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

function entry(
  source: TimelineSource, id: string, entryType: string,
  occurredAt: string, recordedAt: string, summary: string, actorLabel: string | null,
): IncidentTimelineEntry {
  return { stableId: `${source}:${id}`, source, entryType, occurredAt, recordedAt, summary, actorLabel };
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

function compareEntries(left: IncidentTimelineEntry, right: IncidentTimelineEntry): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? -1 : 1;
  if (left.stableId === right.stableId) return 0;
  return left.stableId < right.stableId ? -1 : 1;
}

function encodeCursor(last: IncidentTimelineEntry): string {
  return Buffer.from(`${last.occurredAt}|${last.recordedAt}|${last.stableId}`, 'utf8').toString('base64url');
}

/**
 * A cursor is a position, not a token to be trusted: it is decoded back into the
 * same three ordering fields and compared, so a tampered cursor can only move
 * the window, never widen what the query returns.
 */
function decodeCursor(cursor: string): { occurredAt: string; recordedAt: string; stableId: string } {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const [occurredAt, recordedAt, stableId] = parts;
  if (parts.length !== 3 || !occurredAt || !recordedAt || !stableId
    || Number.isNaN(Date.parse(occurredAt)) || Number.isNaN(Date.parse(recordedAt))) {
    throw new IncidentTimelineCursorError('The timeline cursor could not be read');
  }
  return { occurredAt, recordedAt, stableId };
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return TIMELINE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) return TIMELINE_DEFAULT_LIMIT;
  return Math.min(limit, TIMELINE_MAX_LIMIT);
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
  // Out-of-scope answers 404, not 403 (plan, task 6 step 1): an incident id is
  // guessable, and a 403 would confirm that the one guessed exists. This is a
  // deliberate difference from the detail endpoint, which answers 403.
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  if (!scope.unrestricted && !await isProjectOwnedByScope(scope, core.projectId)) {
    throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  }

  const [actions, observations, attendance, notifications, holds] = await Promise.all([
    listActionSource(incidentId), listObservationSource(incidentId), listAttendanceSource(incidentId),
    listNotificationSource(incidentId), listRetentionHoldSource(incidentId),
  ]);

  const labels = await resolveActorLabels([
    ...actions.map((row) => row.actor_user_id), ...holds.map((row) => row.actor_user_id),
  ]);
  const labelFor = (userId: string | null): string | null => (userId ? labels.get(userId) ?? null : null);

  const merged: IncidentTimelineEntry[] = [
    ...actions.map((row) => {
      const at = iso(row.occurred_at);
      return entry(actionSource(row), row.id, row.action_type, at, at,
        ACTION_SUMMARIES[row.action_type] ?? 'Incident updated', labelFor(row.actor_user_id));
    }),
    ...observations.map((row) => entry(
      'system', row.id, 'observation_recorded', iso(row.observed_at), iso(row.recorded_at),
      'Condition observed', null,
    )),
    ...attendance.map((row) => {
      const at = iso(row.linked_at);
      return entry('attendance', row.id, 'correction_linked', at, at, 'Attendance correction linked', null);
    }),
    ...notifications.map((row) => {
      const at = iso(row.occurred_at);
      return entry('notification', at, 'notification_delivered', at, at,
        `Notified ${row.recipient_count} recipients`, null);
    }),
    ...holds.map((row) => {
      const at = iso(row.occurred_at);
      return entry('retention_hold', row.id, `retention_hold_${row.action_type}`, at, at,
        HOLD_SUMMARIES[row.action_type] ?? 'Retention hold updated', labelFor(row.actor_user_id));
    }),
  ].sort(compareEntries);

  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const remaining = after
    ? merged.filter((candidate) => compareEntries(candidate, {
      ...candidate, occurredAt: after.occurredAt, recordedAt: after.recordedAt, stableId: after.stableId,
    }) > 0)
    : merged;

  const limit = resolveLimit(options.limit);
  const entries = remaining.slice(0, limit);
  const nextCursor = remaining.length > limit && entries.length > 0
    ? encodeCursor(entries[entries.length - 1]!)
    : null;
  return { entries, nextCursor };
}

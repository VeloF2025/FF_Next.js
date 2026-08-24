/**
 * Bounded per-source reads for the scoped incident chronology (stage 8, task 6).
 *
 * There is no timeline table and there never will be one — see the
 * `keeps TimelineSource out of the schema` assertion in
 * `__tests__/migrationContract.test.ts`. Every entry is merged in memory from
 * tables PR4-7 already write.
 *
 * Each projection is deliberately narrow. None of these queries selects a
 * free-text column, a VF Storage locator, a filename, a JSONB blob, or anything
 * that identifies who was messaged — a timeline row is a fact that something
 * happened, not a copy of its contents. The drawer's existing sections already
 * render the bodies to a manager who is allowed to read them, so restating them
 * here would widen the disclosure surface for no gain. `timelineService.test.ts`
 * greps the SQL these functions issue and fails if a forbidden column reappears.
 *
 * Every statement carries a `fleet-incident-timeline:<source>` comment tag. The
 * service fires all five concurrently, so the tag — not call order — is what
 * identifies a statement in logs and in the tests.
 *
 * WHERE clauses are explicit and parameterized, never conditional tagged-template
 * fragments (CLAUDE.md).
 */
import { query } from '@/lib/db-pool';
import type { IncidentActionType, IncidentVisibility } from '../types';
import type { RetentionHoldActionType } from './aggregateSchema';

export interface ActionSourceRow extends Record<string, unknown> {
  id: string;
  action_type: IncidentActionType;
  actor_user_id: string | null;
  is_system_actor: boolean;
  occurred_at: string | Date;
  visibility: IncidentVisibility;
}

export interface ObservationSourceRow extends Record<string, unknown> {
  id: string;
  observed_at: string | Date;
  recorded_at: string | Date;
}

export interface AttendanceSourceRow extends Record<string, unknown> {
  id: string;
  linked_at: string | Date;
}

export interface NotificationSourceRow extends Record<string, unknown> {
  occurred_at: string | Date;
  recipient_count: number;
}

export interface RetentionHoldSourceRow extends Record<string, unknown> {
  id: string;
  action_type: RetentionHoldActionType;
  actor_user_id: string | null;
  occurred_at: string | Date;
}

/**
 * `fleet_operational_incident_actions` is the spine of the chronology, not one
 * source among several: evidence uploads write an `evidence_added` row
 * (`evidenceService.ts`) and driver replies write a `driver_response_received`
 * row (`driver/submissionService.ts`), so reading the evidence and submission
 * tables as well would report each of those events twice.
 *
 * `actor_staff_id` is deliberately not selected. It is set only on driver rows
 * (migration 511), and the incident header already names the driver, so reading
 * it would add a second copy of an identity the viewer already has.
 */
export async function listActionSource(incidentId: string): Promise<ActionSourceRow[]> {
  return query<ActionSourceRow>(
    `/* fleet-incident-timeline:actions */
     SELECT id, action_type, actor_user_id, is_system_actor, occurred_at, visibility
       FROM fleet_operational_incident_actions
      WHERE incident_id = $1::uuid`,
    [incidentId],
  );
}

/**
 * The only source that records when something happened separately from when the
 * system found out, so it is the only one whose entries can legitimately show
 * two different timestamps.
 */
export async function listObservationSource(incidentId: string): Promise<ObservationSourceRow[]> {
  return query<ObservationSourceRow>(
    `/* fleet-incident-timeline:observations */
     SELECT id, observed_at, recorded_at
       FROM fleet_operational_incident_observations
      WHERE incident_id = $1::uuid`,
    [incidentId],
  );
}

/**
 * The link, not the correction's current state: `attendance_adjustments.status`
 * changes after the fact, and a chronology that re-reads it would silently
 * rewrite a past entry every time Attendance moved on. The drawer's existing
 * correction-links section renders the live state instead.
 */
export async function listAttendanceSource(incidentId: string): Promise<AttendanceSourceRow[]> {
  return query<AttendanceSourceRow>(
    `/* fleet-incident-timeline:attendance */
     SELECT id, linked_at
       FROM fleet_incident_attendance_correction_links
      WHERE incident_id = $1::uuid`,
    [incidentId],
  );
}

/**
 * A count per minute, never a row per person. `notificationBus.notify()` writes
 * one row per in-app recipient inside a loop, so the rows of a single fan-out
 * differ by microseconds; grouping on the raw timestamp would turn one
 * notification into N timeline entries and make the size of the audience
 * readable from the shape of the chronology. Minute truncation collapses a
 * fan-out back into the one event it was.
 */
export async function listNotificationSource(incidentId: string): Promise<NotificationSourceRow[]> {
  return query<NotificationSourceRow>(
    `/* fleet-incident-timeline:notifications */
     SELECT date_trunc('minute', created_at) AS occurred_at, COUNT(*)::int AS recipient_count
       FROM user_notifications
      WHERE source_module = 'fleet-incidents' AND source_id = $1
      GROUP BY date_trunc('minute', created_at)`,
    [incidentId],
  );
}

/** Hold actions reach the incident through their hold — there is no direct FK. */
export async function listRetentionHoldSource(incidentId: string): Promise<RetentionHoldSourceRow[]> {
  return query<RetentionHoldSourceRow>(
    `/* fleet-incident-timeline:retention_holds */
     SELECT a.id, a.action_type, a.actor_user_id, a.occurred_at
       FROM fleet_incident_retention_hold_actions a
       JOIN fleet_incident_retention_holds h ON h.id = a.hold_id
      WHERE h.incident_id = $1::uuid`,
    [incidentId],
  );
}

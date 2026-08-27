/**
 * Column lists, row shapes and row→domain mapping for the incident review
 * reads. Split out of `reviewQueries.ts` when that file crossed the 300-line
 * ratchet: it is a different job — the SQL text and the row contract — and
 * keeping it here means the queue and the detail read cannot drift onto two
 * different column lists, because both `SELECT`s are written once, right here.
 *
 * Labels come from the incident's own opened-time snapshot columns, so no join
 * back to `staff`/`projects`/`fleet_vehicles` is needed for either view.
 */
import type {
  IncidentDetail, IncidentListItem, IncidentLifecycleStatus, IncidentOutcome,
  IncidentSeverity, IncidentType, SanitizedIncidentMetadata,
} from './types';

export function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
export function isoOrNull(value: string | Date | null): string | null { return value === null ? null : iso(value); }

export const EVIDENCE_COUNT_SUBQUERY = `(SELECT COUNT(*)::int FROM fleet_operational_incident_evidence e WHERE e.incident_id = fleet_operational_incidents.id)`;

export const LIST_COLUMNS = `id, incident_reference, incident_type, severity, lifecycle_status, staff_id, staff_name_snapshot,
  vehicle_registration_snapshot, project_id, project_name_snapshot, operational_site_name_snapshot, opened_at, condition_last_seen_at,
  condition_cleared_at, escalation_level, next_escalation_at, resolved_at, ${EVIDENCE_COUNT_SUBQUERY} AS evidence_count`;

export interface ListRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: IncidentType; severity: IncidentSeverity; lifecycle_status: IncidentLifecycleStatus;
  staff_id: string | null; staff_name_snapshot: string | null; vehicle_registration_snapshot: string | null;
  project_id: string | null; project_name_snapshot: string | null;
  operational_site_name_snapshot: string | null; opened_at: string | Date; condition_last_seen_at: string | Date | null;
  condition_cleared_at: string | Date | null; escalation_level: number; next_escalation_at: string | Date | null;
  // `resolved_at` is read here only to drive `driverInput`'s closed/expired distinction
  // (PR7 review I2) — it is not itself part of `IncidentListItem`'s public shape.
  resolved_at: string | Date | null; evidence_count: number;
}

/** Everything `mapListRow` can compute directly from one incident row — `driverInput` is
 * deliberately excluded: it needs a second, batched read across
 * `fleet_incident_driver_input_requests`/`fleet_incident_driver_submissions` (see
 * `attachDriverInputSummaries` below), so a caller cannot forget to attach it by having
 * this function's return type silently satisfy `IncidentListItem` without it. */
type IncidentListItemCore = Omit<IncidentListItem, 'driverInput'>;

export function mapListRow(row: ListRow): IncidentListItemCore {
  return {
    id: row.id, incidentReference: row.incident_reference, incidentType: row.incident_type, severity: row.severity,
    lifecycleStatus: row.lifecycle_status, staffId: row.staff_id, staffName: row.staff_name_snapshot,
    vehicleRegistration: row.vehicle_registration_snapshot,
    projectId: row.project_id, projectName: row.project_name_snapshot, operationalSiteName: row.operational_site_name_snapshot,
    openedAt: iso(row.opened_at), conditionLastSeenAt: isoOrNull(row.condition_last_seen_at), conditionClearedAt: isoOrNull(row.condition_cleared_at),
    escalationLevel: row.escalation_level, nextEscalationAt: isoOrNull(row.next_escalation_at), evidenceCount: row.evidence_count,
  };
}

export const DETAIL_COLUMNS = `id, incident_reference, incident_type, severity, lifecycle_status, staff_id, staff_name_snapshot,
  vehicle_registration_snapshot, project_id, project_name_snapshot, operational_site_name_snapshot, source_event_id, evidence_snapshot,
  detected_at, opened_at, condition_last_seen_at, condition_cleared_at,
  acknowledged_by, acknowledged_at, review_started_by, review_started_at,
  escalation_level, last_escalated_at, next_escalation_at, resolved_by, resolved_at, outcome, resolution_note,
  linked_hs_reference, linked_maintenance_reference, ${EVIDENCE_COUNT_SUBQUERY} AS evidence_count`;

export interface DetailRow extends ListRow {
  source_event_id: string | null; evidence_snapshot: SanitizedIncidentMetadata; detected_at: string | Date;
  acknowledged_by: string | null; acknowledged_at: string | Date | null; review_started_by: string | null; review_started_at: string | Date | null;
  resolved_by: string | null; resolved_at: string | Date | null; outcome: IncidentOutcome | null; resolution_note: string | null;
  linked_hs_reference: string | null; linked_maintenance_reference: string | null;
}

export function mapDetailRow(row: DetailRow): IncidentDetailCore {
  return {
    ...mapListRow(row),
    detectedAt: iso(row.detected_at),
    acknowledgedAt: isoOrNull(row.acknowledged_at), acknowledgedBy: row.acknowledged_by,
    reviewStartedAt: isoOrNull(row.review_started_at), reviewStartedBy: row.review_started_by,
    resolvedAt: isoOrNull(row.resolved_at), resolvedBy: row.resolved_by,
    outcome: row.outcome, resolutionNote: row.resolution_note,
    evidenceSnapshot: row.evidence_snapshot, sourceEventId: row.source_event_id,
    linkedHsReference: row.linked_hs_reference, linkedMaintenanceReference: row.linked_maintenance_reference,
  };
}

export type IncidentDetailCore = Omit<IncidentDetail, 'actions' | 'evidence' | 'delivery' | 'driverInput' | 'correctionLinks'>;

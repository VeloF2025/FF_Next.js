/**
 * List/detail read queries for the manager incident-review queue. Every
 * WHERE clause is built as an explicit, parameterized branch — never a
 * conditional tagged-template fragment (CLAUDE.md; `@/lib/db-pool`'s
 * `sql` tag is not used here at all, only `query`/`queryOne`). Labels come
 * from the incident's own opened-time snapshot columns, so no join back to
 * `staff`/`projects` is needed for the queue or detail views.
 */
import { query, queryOne } from '@/lib/db-pool';
import { deriveDriverInputState } from './driver/inputState';
import { getEffectiveDriverInputSettings } from './driver/settingsRepository';
import type { AttendanceCorrectionState, DriverInputState } from './driver/types';
import type { IncidentScopeFilter } from './reviewScope';
import type {
  IncidentAction, IncidentActionType, IncidentCorrectionLink, IncidentDeliverySummary, IncidentDetail, IncidentDriverInputSummary,
  IncidentEvidence, IncidentEvidenceType, IncidentListItem, IncidentListRequest, IncidentListResult, IncidentLifecycleStatus,
  IncidentOutcome, IncidentSeverity, IncidentType, IncidentVisibility, SanitizedIncidentMetadata,
} from './types';

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function isoOrNull(value: string | Date | null): string | null { return value === null ? null : iso(value); }

const EVIDENCE_COUNT_SUBQUERY = `(SELECT COUNT(*)::int FROM fleet_operational_incident_evidence e WHERE e.incident_id = fleet_operational_incidents.id)`;

const LIST_COLUMNS = `id, incident_reference, incident_type, severity, lifecycle_status, staff_id, staff_name_snapshot,
  project_id, project_name_snapshot, operational_site_name_snapshot, opened_at, condition_last_seen_at,
  condition_cleared_at, escalation_level, next_escalation_at, resolved_at, ${EVIDENCE_COUNT_SUBQUERY} AS evidence_count`;

interface ListRow extends Record<string, unknown> {
  id: string; incident_reference: string; incident_type: IncidentType; severity: IncidentSeverity; lifecycle_status: IncidentLifecycleStatus;
  staff_id: string | null; staff_name_snapshot: string | null; project_id: string | null; project_name_snapshot: string | null;
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

function mapListRow(row: ListRow): IncidentListItemCore {
  return {
    id: row.id, incidentReference: row.incident_reference, incidentType: row.incident_type, severity: row.severity,
    lifecycleStatus: row.lifecycle_status, staffId: row.staff_id, staffName: row.staff_name_snapshot,
    projectId: row.project_id, projectName: row.project_name_snapshot, operationalSiteName: row.operational_site_name_snapshot,
    openedAt: iso(row.opened_at), conditionLastSeenAt: isoOrNull(row.condition_last_seen_at), conditionClearedAt: isoOrNull(row.condition_cleared_at),
    escalationLevel: row.escalation_level, nextEscalationAt: isoOrNull(row.next_escalation_at), evidenceCount: row.evidence_count,
  };
}

interface CurrentRequestSummary { requestedAt: string; respondBy: string; deliveryFailedCount: number }

/**
 * Pure state resolution shared by the queue (`attachDriverInputSummaries`) and the detail
 * drawer (`getIncidentDriverInputSummary`) — the one place either caller decides
 * `driverInput.state`, always via `deriveDriverInputState` (PR7 review I2: "reuse that
 * function — do not write a second derivation"). `latestSubmissionAt` is only treated as a
 * genuine response to `currentRequest` when it is at/after that request's `requestedAt` — an
 * unprompted submission from a *previous* (now-superseded) request cycle must not be read as
 * an answer to the current one.
 */
function resolveDriverInputSummary(
  now: string, currentRequest: CurrentRequestSummary | null, latestSubmissionAt: string | null, incidentTerminalAt: string | null,
  settings: { postClosureResponseEnabled: boolean; postClosureResponseWindowDays: number },
): IncidentDriverInputSummary {
  const respondedAt = latestSubmissionAt !== null && (!currentRequest || latestSubmissionAt >= currentRequest.requestedAt)
    ? latestSubmissionAt : null;
  const state: DriverInputState = deriveDriverInputState({
    now, currentRequest: currentRequest ? { requestedAt: currentRequest.requestedAt, respondBy: currentRequest.respondBy } : null,
    respondedAt, incidentTerminalAt,
    postClosureResponseEnabled: settings.postClosureResponseEnabled, postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
  });
  return { state, respondBy: currentRequest?.respondBy ?? null, deliveryFailed: (currentRequest?.deliveryFailedCount ?? 0) > 0 };
}

interface CurrentRequestRow extends Record<string, unknown> {
  incident_id: string; requested_at: string | Date; respond_by: string | Date; delivery_failed_count: number;
}

/** The current (non-superseded) `fleet_incident_driver_input_requests` row per incident, batched via `= ANY($1::uuid[])` rather than one query per row. Column names verified against migration 511 (`requested_at`, `respond_by`, `superseded_at`, `delivery_failed_count`) — no query mocking hides a real schema mismatch here. */
async function loadCurrentDriverInputRequests(incidentIds: string[]): Promise<Map<string, CurrentRequestSummary>> {
  if (incidentIds.length === 0) return new Map();
  const rows = await query<CurrentRequestRow>(
    `SELECT DISTINCT ON (incident_id) incident_id, requested_at, respond_by, delivery_failed_count
     FROM fleet_incident_driver_input_requests
     WHERE incident_id = ANY($1::uuid[]) AND superseded_at IS NULL
     ORDER BY incident_id, requested_at DESC`,
    [incidentIds],
  );
  const map = new Map<string, CurrentRequestSummary>();
  for (const row of rows) {
    map.set(row.incident_id, { requestedAt: iso(row.requested_at), respondBy: iso(row.respond_by), deliveryFailedCount: row.delivery_failed_count });
  }
  return map;
}

interface LatestSubmissionRow extends Record<string, unknown> { incident_id: string; responded_at: string | Date }

/** The most recent `fleet_incident_driver_submissions.created_at` per incident, batched the same way. Column names verified against migration 511 (`incident_id`, `created_at`). */
async function loadLatestSubmissionTimes(incidentIds: string[]): Promise<Map<string, string>> {
  if (incidentIds.length === 0) return new Map();
  const rows = await query<LatestSubmissionRow>(
    `SELECT incident_id, MAX(created_at) AS responded_at FROM fleet_incident_driver_submissions
     WHERE incident_id = ANY($1::uuid[]) GROUP BY incident_id`,
    [incidentIds],
  );
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.incident_id, iso(row.responded_at));
  return map;
}

/**
 * Attaches `driverInput` to every queue row with exactly two extra, batched queries (never
 * one query per row) plus one settings read — not per row either. A coarser three-state
 * signal would have been cheaper, but it would also have been the "second derivation" PR7
 * review I2 flags: this reuses the identical `resolveDriverInputSummary`/
 * `deriveDriverInputState` path the detail drawer uses, so the queue badge and the drawer
 * badge can never disagree (PR7 review I4).
 */
async function attachDriverInputSummaries(rows: ListRow[]): Promise<IncidentListItem[]> {
  if (rows.length === 0) return [];
  const now = new Date().toISOString();
  const ids = rows.map((row) => row.id);
  const [settings, requests, submissions] = await Promise.all([
    getEffectiveDriverInputSettings(now), loadCurrentDriverInputRequests(ids), loadLatestSubmissionTimes(ids),
  ]);
  return rows.map((row) => ({
    ...mapListRow(row),
    driverInput: resolveDriverInputSummary(now, requests.get(row.id) ?? null, submissions.get(row.id) ?? null, isoOrNull(row.resolved_at ?? null), settings),
  }));
}

interface WhereBuild { clause: string; params: unknown[] }

function buildWhere(request: IncidentListRequest, scope: IncidentScopeFilter): WhereBuild {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const push = (value: unknown): number => { params.push(value); return params.length; };

  if (!scope.unrestricted) {
    const userIdx = push(scope.pmUserId);
    const staffIdx = push(scope.pmStaffId);
    conditions.push(`EXISTS (SELECT 1 FROM projects p WHERE p.id = fleet_operational_incidents.project_id
      AND (p.project_manager = $${userIdx}::uuid OR ($${staffIdx}::uuid IS NOT NULL AND p.project_manager = $${staffIdx}::uuid)))`);
  }
  if (request.lifecycleStatuses?.length) conditions.push(`lifecycle_status = ANY($${push(request.lifecycleStatuses)}::text[])`);
  if (request.projectId) conditions.push(`project_id = $${push(request.projectId)}::uuid`);
  if (request.managerUserId) {
    conditions.push(`EXISTS (SELECT 1 FROM projects p WHERE p.id = fleet_operational_incidents.project_id AND p.project_manager = $${push(request.managerUserId)}::uuid)`);
  }
  if (request.incidentTypes?.length) conditions.push(`incident_type = ANY($${push(request.incidentTypes)}::text[])`);
  if (request.severities?.length) conditions.push(`severity = ANY($${push(request.severities)}::text[])`);
  if (request.staffId) conditions.push(`staff_id = $${push(request.staffId)}::uuid`);
  if (request.fromDate) conditions.push(`opened_at::date >= $${push(request.fromDate)}::date`);
  if (request.toDate) conditions.push(`opened_at::date <= $${push(request.toDate)}::date`);
  if (request.overdueOnly) conditions.push(`next_escalation_at IS NOT NULL AND next_escalation_at < now() AND lifecycle_status = 'open'`);
  if (request.conditionState === 'active') conditions.push(`condition_cleared_at IS NULL`);
  if (request.conditionState === 'cleared') conditions.push(`condition_cleared_at IS NOT NULL`);
  if (request.evidenceState === 'present') conditions.push(`${EVIDENCE_COUNT_SUBQUERY} > 0`);
  if (request.evidenceState === 'required') conditions.push(`${EVIDENCE_COUNT_SUBQUERY} = 0`);

  return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export async function listIncidents(request: IncidentListRequest, scope: IncidentScopeFilter): Promise<IncidentListResult> {
  const { clause, params } = buildWhere(request, scope);
  const countRow = await queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM fleet_operational_incidents ${clause}`, params);
  const total = countRow ? Number(countRow.count) : 0;
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await query<ListRow>(
    `SELECT ${LIST_COLUMNS} FROM fleet_operational_incidents ${clause} ORDER BY opened_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, request.limit, request.offset],
  );
  return { incidents: await attachDriverInputSummaries(rows), total };
}

export type IncidentDetailCore = Omit<IncidentDetail, 'actions' | 'evidence' | 'delivery' | 'driverInput' | 'correctionLinks'>;

const DETAIL_COLUMNS = `id, incident_reference, incident_type, severity, lifecycle_status, staff_id, staff_name_snapshot,
  project_id, project_name_snapshot, operational_site_name_snapshot, source_event_id, evidence_snapshot,
  detected_at, opened_at, condition_last_seen_at, condition_cleared_at,
  acknowledged_by, acknowledged_at, review_started_by, review_started_at,
  escalation_level, last_escalated_at, next_escalation_at, resolved_by, resolved_at, outcome, resolution_note,
  linked_hs_reference, linked_maintenance_reference, ${EVIDENCE_COUNT_SUBQUERY} AS evidence_count`;

interface DetailRow extends ListRow {
  source_event_id: string | null; evidence_snapshot: SanitizedIncidentMetadata; detected_at: string | Date;
  acknowledged_by: string | null; acknowledged_at: string | Date | null; review_started_by: string | null; review_started_at: string | Date | null;
  resolved_by: string | null; resolved_at: string | Date | null; outcome: IncidentOutcome | null; resolution_note: string | null;
  linked_hs_reference: string | null; linked_maintenance_reference: string | null;
}

function mapDetailRow(row: DetailRow): IncidentDetailCore {
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

export async function getIncidentCore(incidentId: string): Promise<IncidentDetailCore | null> {
  const row = await queryOne<DetailRow>(`SELECT ${DETAIL_COLUMNS} FROM fleet_operational_incidents WHERE id = $1::uuid`, [incidentId]);
  return row ? mapDetailRow(row) : null;
}

/**
 * The single incident's `driverInput` summary for the detail drawer (PR7 review C1/I2/I3).
 * Self-sufficient (reads its own settings) rather than taking them as a parameter, so
 * `reviewService.ts#getIncidentDetailForViewer` needs no `driver/settingsRepository` import
 * of its own — reuses `loadCurrentDriverInputRequests`/`loadLatestSubmissionTimes` with a
 * one-element id array rather than a bespoke single-incident query, so the queue and the
 * drawer can never read this off two different SQL shapes.
 */
export async function getIncidentDriverInputSummary(
  incidentId: string, incidentTerminalAt: string | null, now: string,
): Promise<IncidentDriverInputSummary> {
  const settings = await getEffectiveDriverInputSettings(now);
  const [requests, submissions] = await Promise.all([
    loadCurrentDriverInputRequests([incidentId]), loadLatestSubmissionTimes([incidentId]),
  ]);
  return resolveDriverInputSummary(now, requests.get(incidentId) ?? null, submissions.get(incidentId) ?? null, incidentTerminalAt, settings);
}

const CORRECTION_LINK_COLUMNS = `l.id, l.attendance_correction_id, l.linked_at, a.status`;

interface CorrectionLinkRow extends Record<string, unknown> {
  id: string; attendance_correction_id: string; linked_at: string | Date; status: AttendanceCorrectionState;
}

/**
 * Every Attendance correction linked to `incidentId`, regardless of which driver it belongs
 * to — the caller (`reviewService.ts#getIncidentDetailForViewer`) has already gated the
 * whole detail read on manager project scope, so this deliberately does NOT repeat a
 * per-driver `staff_id` filter the way `driverIncidentService.ts#loadOwnCorrectionLinks`
 * does for the `/my` portal (PR7 review C1: "reuse the existing enforcement ... rather than
 * adding a second scope check"). `correctionState` is `a.status`, read live off
 * `attendance_adjustments` on every call — never cached (design §8).
 */
export async function getIncidentCorrectionLinks(incidentId: string): Promise<IncidentCorrectionLink[]> {
  const rows = await query<CorrectionLinkRow>(
    `SELECT ${CORRECTION_LINK_COLUMNS}
     FROM fleet_incident_attendance_correction_links l
     JOIN attendance_adjustments a ON a.id = l.attendance_correction_id
     WHERE l.incident_id = $1::uuid ORDER BY l.linked_at ASC`,
    [incidentId],
  );
  return rows.map((row) => ({
    id: row.id, attendanceCorrectionId: row.attendance_correction_id, linkedAt: iso(row.linked_at), correctionState: row.status,
  }));
}

const ACTION_COLUMNS = `id, action_type, actor_user_id, is_system_actor, occurred_at, note, visibility, before_lifecycle_status,
  after_lifecycle_status, before_escalation_level, after_escalation_level, metadata, request_correlation_id`;

interface ActionRow extends Record<string, unknown> {
  id: string; action_type: IncidentActionType; actor_user_id: string | null; is_system_actor: boolean; occurred_at: string | Date; note: string | null;
  visibility: IncidentVisibility;
  before_lifecycle_status: IncidentLifecycleStatus | null; after_lifecycle_status: IncidentLifecycleStatus | null;
  before_escalation_level: number | null; after_escalation_level: number | null; metadata: SanitizedIncidentMetadata; request_correlation_id: string | null;
}

export async function getIncidentActions(incidentId: string): Promise<IncidentAction[]> {
  const rows = await query<ActionRow>(
    `SELECT ${ACTION_COLUMNS} FROM fleet_operational_incident_actions WHERE incident_id = $1::uuid ORDER BY occurred_at DESC`, [incidentId],
  );
  return rows.map((row) => ({
    id: row.id, actionType: row.action_type, actorUserId: row.actor_user_id, isSystemActor: row.is_system_actor,
    occurredAt: iso(row.occurred_at), note: row.note, visibility: row.visibility, beforeLifecycleStatus: row.before_lifecycle_status,
    afterLifecycleStatus: row.after_lifecycle_status, beforeEscalationLevel: row.before_escalation_level,
    afterEscalationLevel: row.after_escalation_level, metadata: row.metadata, requestCorrelationId: row.request_correlation_id,
  }));
}

const EVIDENCE_COLUMNS = `id, evidence_type, storage_url, storage_key, mime_type, original_filename, uploaded_by, description, visibility, created_at`;

interface EvidenceRow extends Record<string, unknown> {
  id: string; evidence_type: IncidentEvidenceType; storage_url: string; storage_key: string; mime_type: string | null;
  original_filename: string | null; uploaded_by: string | null; description: string | null; visibility: IncidentVisibility; created_at: string | Date;
}

export async function getIncidentEvidence(incidentId: string): Promise<IncidentEvidence[]> {
  const rows = await query<EvidenceRow>(
    `SELECT ${EVIDENCE_COLUMNS} FROM fleet_operational_incident_evidence WHERE incident_id = $1::uuid ORDER BY created_at DESC`, [incidentId],
  );
  return rows.map((row) => ({
    id: row.id, evidenceType: row.evidence_type, storageUrl: row.storage_url, storageKey: row.storage_key,
    mimeType: row.mime_type, originalFilename: row.original_filename, uploadedBy: row.uploaded_by,
    description: row.description, visibility: row.visibility, createdAt: iso(row.created_at),
  }));
}

/**
 * `user_notifications` rows are the only durable per-incident delivery
 * record (`notificationBus.notify()` writes one there per in-app-enabled
 * recipient, tagged `source_module = 'fleet-incidents'`, `source_id =
 * incidentId` — see `incidentNotifications.ts`). A muted/suppressed or
 * email/WhatsApp-only recipient never gets a row, so this is a bounded,
 * coordinate-free "at least this many were notified" count, not an exact
 * reconstruction of the original `NotifyResult`.
 */
export async function getIncidentDeliverySummary(incidentId: string): Promise<IncidentDeliverySummary> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM user_notifications WHERE source_module = 'fleet-incidents' AND source_id = $1`, [incidentId],
  );
  return { delivered: row ? Number(row.count) : 0, suppressed: 0, failed: 0 };
}

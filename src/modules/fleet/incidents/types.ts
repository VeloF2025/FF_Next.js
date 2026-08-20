import type { NotificationChannel, NotifyResult } from '@/modules/notifications/types';
// Type-only: `driver/types.ts` itself imports `IncidentSeverity`/`IncidentType` from this
// file, so this is a type-level cycle by construction — safe because `import type` is fully
// erased at compile time (no runtime module-init order exists to break). Reusing
// `DriverInputState`/`AttendanceCorrectionState` here, rather than redeclaring the same
// literal unions, is what lets `IncidentListItem.driverInput`/`IncidentCorrectionLink` and
// the driver portal's own types stay a single source of truth (PR7 review C1/I2/I3).
import type { AttendanceCorrectionState, DriverInputState } from './driver/types';

export type IncidentType =
  | 'late' | 'wrong_site' | 'evidence_mismatch' | 'left_early'
  | 'unassigned' | 'unverifiable' | 'evidence_gap' | 'vehicle_on_site_driver_unconfirmed'
  | 'accident_sos' | 'dangerous_area_entry' | 'theft_after_hours_movement' | 'severe_driving'
  | 'prolonged_unauthorized_stop' | 'lost_contact_moving';

export type IncidentSeverity = 'normal' | 'high' | 'critical';
export type IncidentLifecycleStatus = 'open' | 'acknowledged' | 'under_review' | 'resolved' | 'dismissed';
export type IncidentOutcome =
  | 'confirmed' | 'valid_reason' | 'false_positive' | 'data_gap'
  | 'assignment_error' | 'geofence_error' | 'duplicate' | 'no_action_required';
/**
 * `driver_input_requested`/`driver_response_received` are written by PR7's
 * driver-input domain (migration 503's `fleet_operational_incident_actions`
 * type-check constraint) — added here so the manager queue (Task 8) can
 * type-check timeline authorship without an unsound `as string` cast; the
 * values themselves have flowed through `getIncidentActions` since PR7
 * Task 3, this union just now names them.
 */
export type IncidentActionType =
  | 'opened' | 'acknowledged' | 'review_started' | 'commented' | 'escalated'
  | 'condition_cleared' | 'resolved' | 'dismissed' | 'evidence_added' | 'recipient_changed'
  | 'driver_input_requested' | 'driver_response_received';
export type IncidentEvidenceType = 'photo' | 'document' | 'manager_note' | 'external_reference';
/**
 * PR7 (migration 503) visibility classification on `fleet_operational_incident_actions`/
 * `fleet_operational_incident_evidence`. `internal` is manager-only; `shared_with_driver` is
 * manager-authored content also made visible to the linked driver; `driver_submitted` is
 * content the driver itself submitted. Existing PR6 rows and any future manager-authored row
 * default to `internal` so nothing is retroactively or accidentally disclosed to a driver.
 */
export type IncidentVisibility = 'internal' | 'shared_with_driver' | 'driver_submitted';
export type MonitorRunKind = 'status_monitor' | 'escalation' | 'morning_summary';
export type MonitorRunStatus = 'running' | 'succeeded' | 'partial_failure' | 'failed';
export type IncidentProducerKind = 'scheduled_detection' | 'source_event';
export type ScheduledIncidentType = 'late' | 'wrong_site' | 'evidence_mismatch' | 'left_early';

export type SanitizedIncidentMetadata = Record<string, string | number | boolean | null>;

export interface IncidentSourceEvent {
  producerKind: 'source_event';
  incidentType: IncidentType;
  sourceEventId: string;
  occurredAt: string;
  staffId?: string | null;
  vehicleId?: string | null;
  projectId?: string | null;
  operationalSiteId?: string | null;
  operationalAssignmentId?: string | null;
  linkedHsReference?: string | null;
  linkedMaintenanceReference?: string | null;
  metadata: SanitizedIncidentMetadata;
}

export interface IncidentAssignmentContext {
  staffId: string | null;
  vehicleId: string | null;
  projectId: string | null;
  operationalSiteId: string | null;
  operationalAssignmentId: string | null;
  staffNameSnapshot: string | null;
  projectNameSnapshot: string | null;
  operationalSiteNameSnapshot: string | null;
  vehicleRegistrationSnapshot: string | null;
}

export interface IncidentRuleReference {
  incidentRuleId: string;
  incidentRuleVersion: number;
  statusRuleId: string;
  statusRuleVersion: number;
}

export interface IncidentEvaluation {
  observedAt: string;
  observationFingerprint: string;
  primaryStatus: string | null;
  flags: string[];
  reasonCodes: string[];
}

interface IncidentProducerBase {
  severity?: IncidentSeverity;
  evidenceSnapshot?: SanitizedIncidentMetadata;
  requestCorrelationId?: string | null;
}

export interface ScheduledIncidentProducerRequest extends IncidentProducerBase {
  producerKind: 'scheduled_detection';
  /**
   * The `fleet_operational_monitor_runs` row this detection belongs to, persisted onto each
   * observation so `WHERE monitor_run_id = $1` can retrieve everything one tick produced.
   * Deliberately separate from `requestCorrelationId`: that is free-form TEXT for audit
   * correlation, whereas this is a UUID foreign key and must stay one.
   */
  monitorRunId?: string | null;
  incidentType: ScheduledIncidentType;
  sourceEventId?: never;
  workDate: string;
  assignment: IncidentAssignmentContext;
  rules: IncidentRuleReference;
  evaluation: IncidentEvaluation;
}

export type IncidentProducerRequest =
  | (IncidentSourceEvent & IncidentProducerBase)
  | ScheduledIncidentProducerRequest;

export interface IncidentProducerResult {
  incidentId: string;
  incidentReference: string;
  created: boolean;
  lifecycleStatus: IncidentLifecycleStatus;
}

export interface IncidentMonitorRequest {
  requestedAt: string;
  effectiveAt: string;
  requestCorrelationId?: string | null;
}

export interface IncidentMonitorResult {
  monitorRunId: string;
  status: MonitorRunStatus;
  rosterEvaluatedCount: number;
  incidentsOpenedCount: number;
  incidentsUpdatedCount: number;
  incidentsClearedCount: number;
  notifications: IncidentDeliverySummary;
}

export interface IncidentActionRunnerRequest {
  requestedAt: string;
  effectiveAt: string;
  requestCorrelationId?: string | null;
}

export interface IncidentActionRunnerResult {
  monitorRunId: string;
  status: MonitorRunStatus;
  escalatedCount: number;
  summariesSentCount: number;
  notifications: IncidentDeliverySummary;
}

export type IncidentDeliverySummary = NotifyResult;

export interface IncidentListRequest {
  lifecycleStatuses?: IncidentLifecycleStatus[];
  projectId?: string;
  managerUserId?: string;
  incidentTypes?: IncidentType[];
  severities?: IncidentSeverity[];
  staffId?: string;
  fromDate?: string;
  toDate?: string;
  overdueOnly?: boolean;
  conditionState?: 'active' | 'cleared';
  evidenceState?: 'required' | 'present';
  limit: number;
  offset: number;
}

/**
 * Manager-facing view of the driver-input state machine on one incident
 * (PR7 review I2/I3/I4). Always derived via `../driver/inputState.ts`'s
 * `deriveDriverInputState` — never a second, independently-reasoned
 * heuristic (the ordering-only badge this replaced could not tell
 * "response window closed" from "driver hasn't answered yet"). `respondBy`
 * and `deliveryFailed` are the durable `fleet_incident_driver_input_requests`
 * columns (`respond_by`, `delivery_failed_count`) that were previously
 * written but never read anywhere a manager could see them.
 */
export interface IncidentDriverInputSummary {
  state: DriverInputState;
  /** The current (non-superseded) request's due date, or `null` when no request currently governs this incident. */
  respondBy: string | null;
  /** `true` when the current request's `delivery_failed_count > 0` — the driver-input notification never reached the driver (design §13). */
  deliveryFailed: boolean;
}

/** One durable `fleet_incident_attendance_correction_links` row, manager-visible (PR7 review C1). `correctionState` is read live from `attendance_adjustments.status` on every call — never a second, cached authoritative status (design §8). */
export interface IncidentCorrectionLink {
  id: string;
  attendanceCorrectionId: string;
  linkedAt: string;
  correctionState: AttendanceCorrectionState;
}

export interface IncidentListItem {
  id: string;
  incidentReference: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  lifecycleStatus: IncidentLifecycleStatus;
  staffId: string | null;
  staffName: string | null;
  projectId: string | null;
  projectName: string | null;
  operationalSiteName: string | null;
  openedAt: string;
  conditionLastSeenAt: string | null;
  conditionClearedAt: string | null;
  escalationLevel: number;
  nextEscalationAt: string | null;
  evidenceCount: number;
  driverInput: IncidentDriverInputSummary;
}

export interface IncidentListResult {
  incidents: IncidentListItem[];
  total: number;
}

export interface IncidentDetail extends IncidentListItem {
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  reviewStartedAt: string | null;
  reviewStartedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  outcome: IncidentOutcome | null;
  resolutionNote: string | null;
  evidenceSnapshot: SanitizedIncidentMetadata;
  sourceEventId: string | null;
  linkedHsReference: string | null;
  linkedMaintenanceReference: string | null;
  actions: IncidentAction[];
  evidence: IncidentEvidence[];
  delivery: IncidentDeliverySummary;
  /** Every Attendance correction linked to this incident, regardless of which driver submission (if any) started it — manager project scope already gates the whole detail read, so this is not separately staff-scoped (PR7 review C1). */
  correctionLinks: IncidentCorrectionLink[];
}

export interface IncidentAction {
  id: string;
  actionType: IncidentActionType;
  actorUserId: string | null;
  isSystemActor: boolean;
  occurredAt: string;
  note: string | null;
  visibility: IncidentVisibility;
  beforeLifecycleStatus: IncidentLifecycleStatus | null;
  afterLifecycleStatus: IncidentLifecycleStatus | null;
  beforeEscalationLevel: number | null;
  afterEscalationLevel: number | null;
  metadata: SanitizedIncidentMetadata;
  requestCorrelationId: string | null;
}

export interface IncidentEvidence {
  id: string;
  evidenceType: IncidentEvidenceType;
  storageUrl: string;
  storageKey: string;
  mimeType: string | null;
  originalFilename: string | null;
  uploadedBy: string | null;
  description: string | null;
  visibility: IncidentVisibility;
  createdAt: string;
}

export interface IncidentTransitionRequest {
  incidentId: string;
  actionType: Exclude<IncidentActionType, 'opened' | 'escalated' | 'condition_cleared' | 'evidence_added' | 'recipient_changed'>;
  actorUserId: string;
  note?: string | null;
  outcome?: IncidentOutcome | null;
  linkedIncidentReference?: string | null;
  requestCorrelationId?: string | null;
}

export interface IncidentTransitionResult {
  incidentId: string;
  lifecycleStatus: IncidentLifecycleStatus;
  actionId: string;
}

export interface IncidentRule {
  id: string;
  incidentType: IncidentType;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  enabled: boolean;
  createsIncident: boolean;
  severity: IncidentSeverity;
  immediateNotification: boolean;
  channels: { inApp: boolean; email: boolean; whatsapp: boolean };
  includeInMorningSummary: boolean;
  acknowledgementTargetMinutes: number;
  reminderIntervalMinutes: number;
  maximumEscalationLevel: number;
  evidenceRequiredOutcomes: IncidentOutcome[];
}

/**
 * Only the mandatory bypass. Ordinary channel selection is notify()'s job — it resolves
 * per-user preferences against the registry — so a `channels` field here was computed and
 * never read. Carrying it invited exactly the misreading that let the mandatory-WhatsApp
 * decision key off the wrong severity: a reader could reasonably assume it governed delivery.
 */
export interface IncidentNotificationPlan {
  mandatoryChannels: NotificationChannel[];
}

// Shared predicate for the one case that must always reach WhatsApp
// regardless of the routine `whatsapp: false` default or a muted per-user
// preference: a critical incident on an explicit source event. Used both for
// the opened notification (via the plan below) and for escalation
// notifications (`sendEscalationNotification` in incidentNotifications.ts) —
// keep both call sites on this single predicate rather than re-deriving it.
export function requiresMandatoryIncidentWhatsApp(
  severity: IncidentSeverity,
  producerKind: IncidentProducerKind,
): boolean {
  return severity === 'critical' && producerKind === 'source_event';
}

/**
 * `severity` is the incident's RESOLVED severity, not `rule.severity`. produceIncident
 * computes it as `request.severity ?? rule.severity`, so a source event may override the
 * rule's default — and it is the override that has to decide mandatory WhatsApp. Reading
 * `rule.severity` here would silently downgrade a critical override on a rule configured
 * `high`, which is exactly the delivery guarantee this function exists to enforce.
 * sendEscalationNotification already derives it this way from the persisted incident row.
 */
export function resolveIncidentOpenedNotification(
  rule: IncidentRule,
  severity: IncidentSeverity,
  producerKind: IncidentProducerKind,
): IncidentNotificationPlan {
  const requiresWhatsApp = requiresMandatoryIncidentWhatsApp(severity, producerKind);

  return { mandatoryChannels: requiresWhatsApp ? ['whatsapp'] : [] };
}

export interface IncidentRuleChangeRequest extends Omit<IncidentRule, 'id' | 'version' | 'effectiveTo'> {
  effectiveFrom: string;
  changeReason: string;
  actorUserId: string;
}

export interface OversightMembership {
  id: string;
  userId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
}

export interface OversightMembershipRequest {
  userId: string;
  effectiveFrom?: string;
  reason?: string | null;
  actorUserId: string;
}

/** An active FibreFlow user as exposed by the settings user-search/name-resolution
 * endpoint — deliberately excludes email and every other account field. */
export interface ActiveUserOption {
  id: string;
  name: string;
}

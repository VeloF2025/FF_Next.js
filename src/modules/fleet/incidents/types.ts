import type { ChannelPreferences, NotificationChannel, NotifyResult } from '@/modules/notifications/types';

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
export type IncidentActionType =
  | 'opened' | 'acknowledged' | 'review_started' | 'commented' | 'escalated'
  | 'condition_cleared' | 'resolved' | 'dismissed' | 'evidence_added' | 'recipient_changed';
export type IncidentEvidenceType = 'photo' | 'document' | 'manager_note' | 'external_reference';
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
}

export interface IncidentAction {
  id: string;
  actionType: IncidentActionType;
  actorUserId: string | null;
  isSystemActor: boolean;
  occurredAt: string;
  note: string | null;
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

export interface IncidentNotificationPlan {
  channels: ChannelPreferences;
  mandatoryChannels: NotificationChannel[];
}

export function resolveIncidentOpenedNotification(
  rule: IncidentRule,
  producerKind: IncidentProducerKind,
): IncidentNotificationPlan {
  const requiresWhatsApp = rule.severity === 'critical' && producerKind === 'source_event';

  return {
    channels: {
      in_app: rule.channels.inApp,
      email: rule.channels.email,
      whatsapp: requiresWhatsApp || rule.channels.whatsapp,
    },
    mandatoryChannels: requiresWhatsApp ? ['whatsapp'] : [],
  };
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

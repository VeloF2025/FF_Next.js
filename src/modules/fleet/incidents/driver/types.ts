import type { NotifyResult } from '@/modules/notifications/types';

export type DriverInputState = 'not_requested' | 'requested' | 'responded' | 'expired' | 'closed';
export type IncidentVisibility = 'internal' | 'shared_with_driver' | 'driver_submitted';
export type DriverConcernCategory = 'assignment_error' | 'site_error' | 'vehicle_error' | 'geofence_error' | 'other';
export type DriverSubmissionKind = 'response' | 'follow_up';

export type AttendanceCorrectionState = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DriverInputSettings {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  responseWindowWorkdays: number;
  postClosureResponseEnabled: boolean;
  postClosureResponseWindowDays: number;
  recentWindowDays: number;
  historyWindowDays: number;
  enabledConcernCategories: DriverConcernCategory[];
  evidenceAllowedMimeTypes: string[];
  evidenceMaxBytes: number;
  driverInputRequestedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
  driverResponseReceivedChannels: { inApp: boolean; email: boolean; whatsapp: boolean };
}

export interface DriverInputRequestSummary {
  id: string;
  guidance: string | null;
  requestedAt: string;
  respondBy: string;
}

/** One driver-visible entry in the incident's timeline. Never carries recipient
 * lists, escalation internals, coordinates, or internal-only notes. */
export interface DriverIncidentTimelineEntry {
  id: string;
  kind: 'action' | 'evidence' | 'submission' | 'request';
  visibility: Exclude<IncidentVisibility, 'internal'>;
  occurredAt: string;
  label: string;
  note: string | null;
}

export interface DriverIncidentListItem {
  id: string;
  incidentReference: string;
  // Deliberately NO raw incidentType or severity. The design's driver-facing summary is an
  // inclusion list and names the *neutral type label*, not the internal enum: shipping
  // `theft_after_hours_movement` or `accident_sos` to a driver is the accusatory-language
  // leak the design forbids, and it would leak server-side regardless of what the UI renders.
  neutralLabel: string;
  projectLabel: string | null;
  siteLabel: string | null;
  detectedAt: string;
  conditionState: 'active' | 'cleared';
  lifecyclePresentation: string;
  driverInputState: DriverInputState;
  currentRequest: DriverInputRequestSummary | null;
  respondedAt: string | null;
}

export interface DriverIncidentListRequest {
  history?: boolean;
  fromDate?: string;
  toDate?: string;
  limit: number;
  offset: number;
}

export interface DriverIncidentListResponse {
  incidents: DriverIncidentListItem[];
  total: number;
  recentWindowDays: number;
  historyWindowDays: number;
}

export interface DriverSubmissionSummary {
  id: string;
  submissionKind: DriverSubmissionKind;
  explanation: string;
  concernCategory: DriverConcernCategory | null;
  createdAt: string;
}

export interface DriverCorrectionLinkSummary {
  id: string;
  attendanceCorrectionId: string;
  linkedAt: string;
  correctionState: AttendanceCorrectionState;
}

/**
 * Driver-safe detail only: neutral labels, timestamps, lifecycle presentation,
 * condition state, visible timeline, current request, own correction links,
 * response eligibility, and settings-derived limits. No recipient,
 * escalation, coordinate, raw-evidence, or internal-note fields.
 */
export interface DriverIncidentDetail extends DriverIncidentListItem {
  explanationSummary: string | null;
  timeline: DriverIncidentTimelineEntry[];
  ownSubmissions: DriverSubmissionSummary[];
  ownCorrectionLinks: DriverCorrectionLinkSummary[];
  responseEligible: boolean;
  responseIneligibleReason: 'closed' | 'expired' | 'outside_window' | null;
  enabledConcernCategories: DriverConcernCategory[];
}

/** User-entered content only. Actor identity (the requesting manager) is
 * always a separate server-derived argument, never part of this command. */
export interface RequestDriverInputCommand {
  incidentId: string;
  guidance?: string | null;
  respondBy?: string | null;
  idempotencyKey: string;
}

export interface DriverInputRequestResult {
  inputRequestId: string;
  incidentId: string;
  respondBy: string;
  driverInputState: DriverInputState;
  notification: NotifyResult;
}

/** User-entered content only. The submitting driver's staff identity is
 * always a separate server-derived argument (sessionStaffId), never part
 * of this command. */
export interface SubmitDriverResponseCommand {
  incidentId: string;
  submissionKind: DriverSubmissionKind;
  explanation: string;
  concernCategory?: DriverConcernCategory | null;
  idempotencyKey: string;
}

export interface DriverSubmissionResult {
  submissionId: string;
  incidentId: string;
  driverInputState: DriverInputState;
  created: boolean;
}

export interface DriverEvidenceResult {
  evidenceId: string;
  incidentId: string;
  storageUrl: string;
}

export type AttendanceCorrectionEligibility =
  | { eligible: true; exceptionId: string; entryId: string }
  /**
   * `retryCorrectionId`: a correction the driver already submitted for this
   * work date that Fleet has not yet linked to this incident, or `null` if
   * none exists — the server-derived fact the driver portal offers a
   * "retry linking" action for. Replaces a former client-side `localStorage`
   * marker written on link failure, which had a silent permanent-failure
   * mode when the *write* itself failed (private mode, storage full, or the
   * driver finishing the correction on a different device).
   */
  | { eligible: false; reason: 'no_required_exception'; retryCorrectionId: string | null }
  | { eligible: false; reason: 'period_locked' | 'outside_response_window' };

export interface AttendanceCorrectionLinkResult {
  linkId: string;
  incidentId: string;
  attendanceCorrectionId: string;
  correctionState: AttendanceCorrectionState;
}

/**
 * Shared human-readable labels for the incident queue's own enums —
 * `IncidentType`, `IncidentLifecycleStatus`, `IncidentSeverity`,
 * `IncidentOutcome`, plus the two ad-hoc filter enums (condition/evidence
 * state). `IncidentTable.tsx` already had `TYPE_LABELS`/`LIFECYCLE_LABELS`/
 * `SEVERITY_LABELS` and `IncidentActionPanel.tsx` its own `OUTCOME_LABELS`;
 * this file is that same convention pulled into one place so the queue's
 * filter bar and the settings dialog's rule editor stop falling back to
 * raw `snake_case` database values (`accident sos`, `data gap`, `high`)
 * instead of reusing them. Not a new convention — every incident-domain
 * component importing from here keeps its own file under the size cap and
 * can no longer drift from the table/drawer/action-panel wording.
 */
import type { IncidentLifecycleStatus, IncidentOutcome, IncidentSeverity, IncidentType } from '../types';

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  late: 'Late', wrong_site: 'Wrong site', evidence_mismatch: 'Evidence mismatch', left_early: 'Left early',
  unassigned: 'Unassigned', unverifiable: 'Unverifiable', evidence_gap: 'Evidence gap',
  vehicle_on_site_driver_unconfirmed: 'Vehicle on site — driver unconfirmed',
  accident_sos: 'Accident / SOS', dangerous_area_entry: 'Dangerous area entry',
  theft_after_hours_movement: 'Theft — after-hours movement', severe_driving: 'Severe driving',
  prolonged_unauthorized_stop: 'Prolonged unauthorized stop', lost_contact_moving: 'Lost contact while moving',
};

export const LIFECYCLE_STATUS_LABELS: Record<IncidentLifecycleStatus, string> = {
  open: 'Open', acknowledged: 'Acknowledged', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed',
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = { normal: 'Normal', high: 'High', critical: 'Critical' };

export const OUTCOME_LABELS: Record<IncidentOutcome, string> = {
  confirmed: 'Confirmed', valid_reason: 'Valid reason', false_positive: 'False positive', data_gap: 'Data gap',
  assignment_error: 'Assignment error', geofence_error: 'Geofence error', duplicate: 'Duplicate', no_action_required: 'No action required',
};

/** The queue's own `conditionState`/`evidenceState` filters (`IncidentListRequest`) aren't
 * database enums — they're derived query params — but still read as unlabelled jargon
 * (`active`, `cleared`, `required`, `present`) without a word explaining what they filter. */
export const CONDITION_STATE_LABELS: Record<'active' | 'cleared', string> = { active: 'Still active', cleared: 'Cleared' };
export const EVIDENCE_STATE_LABELS: Record<'required' | 'present', string> = { required: 'Evidence required', present: 'Evidence attached' };

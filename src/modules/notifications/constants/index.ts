/**
 * Unified Notification Service - Constants & Event Registry
 * @module notifications/constants
 */

import type { ChannelPreferences, NotificationSeverity } from '../types';

// =============================================================================
// Default Channel Preferences per Event Type
// =============================================================================

export const DEFAULT_CHANNEL_PREFERENCES: Record<string, ChannelPreferences> = {
  // -- Maintenance --
  'noc.ticket_assigned':    { in_app: true, email: true,  whatsapp: false },
  'noc.ticket_stepped':     { in_app: true, email: false, whatsapp: false },
  'noc.ticket_transferred': { in_app: true, email: true,  whatsapp: true  },
  'noc.qa_rejected':        { in_app: true, email: true,  whatsapp: true  },
  'noc.qa_approved':        { in_app: true, email: false, whatsapp: false },
  'noc.escalation_created': { in_app: true, email: true,  whatsapp: true  },
  'noc.sla_warning':        { in_app: true, email: true,  whatsapp: true  },
  'noc.ticket_closed':      { in_app: true, email: false, whatsapp: false },
  'noc.ticket_team_assigned': { in_app: true, email: true,  whatsapp: true  },
  'noc.ticket_status_changed': { in_app: true, email: true,  whatsapp: false },
  'noc.ticket_unassigned':    { in_app: true, email: true,  whatsapp: false },

  // -- Activate / QField --
  'activate.qa_rejected':           { in_app: true, email: true,  whatsapp: true  },
  'activate.qa_approved':           { in_app: true, email: false, whatsapp: false },

  // -- Project Management --
  'project.staff_assigned':         { in_app: true, email: true,  whatsapp: false },
  'project.staff_removed':          { in_app: true, email: true,  whatsapp: false },
  'project.pm_changed':             { in_app: true, email: true,  whatsapp: false },
  'project.status_changed':         { in_app: true, email: false, whatsapp: false },

  // -- Procurement --
  'procurement.approval_needed':    { in_app: true, email: true,  whatsapp: false },
  'procurement.approved':           { in_app: true, email: true,  whatsapp: false },
  'procurement.rejected':           { in_app: true, email: true,  whatsapp: false },

  // -- Internal Messaging --
  'messaging.new_message':          { in_app: true, email: true,  whatsapp: false },

  // -- Compliance & Fleet --
  'compliance.document_expiring':   { in_app: true, email: true,  whatsapp: false },
  'compliance.hs_incident':         { in_app: true, email: true,  whatsapp: true  },
  'fleet.license_expiring':         { in_app: true, email: true,  whatsapp: false },
  'fleet.parking_violation':        { in_app: true, email: true,  whatsapp: false },
  'fleet.parking_change_requested': { in_app: true, email: true,  whatsapp: false },
  // Email as well as in-app: a decline carries disciplinary weight, and in-app
  // alone means the driver finds out whenever they next happen to open /my.
  'fleet.parking_change_decided':   { in_app: true, email: true,  whatsapp: false },
  'fleet.tracking_pull_failed':     { in_app: true, email: true,  whatsapp: true  },
  'fleet.tracking_data_gap':        { in_app: true, email: true,  whatsapp: false },
  'fleet.tracking_pull_degraded':   { in_app: true, email: true,  whatsapp: false },
  'fleet.operational_incident_opened': { in_app: true, email: true, whatsapp: false },
  // Routine default, same as _opened/_resolved: a critical explicit-source-event
  // escalation still reaches WhatsApp, but via the sendMandatoryWhatsApp bypass in
  // incidentNotifications.ts — never by broadening this default (see that file's
  // module docblock for why notify() alone cannot express a per-call override).
  'fleet.operational_incident_escalated': { in_app: true, email: true, whatsapp: false },
  'fleet.operational_incident_resolved': { in_app: true, email: true, whatsapp: false },
  'fleet.operational_morning_summary': { in_app: true, email: true, whatsapp: false },
  'fleet.operational_monitor_failed': { in_app: true, email: true, whatsapp: true },

  // -- Attendance --
  'attendance.clockout_due':        { in_app: true, email: false, whatsapp: false },
  'attendance.correction_required': { in_app: true, email: false, whatsapp: false },
  'attendance.supervisor_digest':   { in_app: true, email: false, whatsapp: false },
  'attendance.hr_readiness':        { in_app: true, email: false, whatsapp: false },

  // Fallback for unregistered event types
  _fallback:                        { in_app: true, email: false, whatsapp: false },
};

// =============================================================================
// Event Icons (Lucide icon names)
// =============================================================================

export const EVENT_ICONS: Record<string, string> = {
  'noc.ticket_assigned':    'wrench',
  'noc.ticket_stepped':     'arrow-right',
  'noc.ticket_transferred': 'arrow-right-left',
  'noc.qa_rejected':        'x-circle',
  'noc.qa_approved':        'check-circle',
  'noc.escalation_created': 'alert-triangle',
  'noc.sla_warning':        'clock',
  'noc.ticket_closed':      'check-square',
  'noc.ticket_team_assigned': 'users',
  'noc.ticket_status_changed': 'refresh-cw',
  'noc.ticket_unassigned':    'user-minus',

  'activate.qa_rejected':           'x-circle',
  'activate.qa_approved':           'check-circle',

  'project.staff_assigned':         'user-plus',
  'project.staff_removed':          'user-minus',
  'project.pm_changed':             'users',
  'project.status_changed':         'activity',

  'procurement.approval_needed':    'file-check',
  'procurement.approved':           'check-circle',
  'procurement.rejected':           'x-circle',

  'messaging.new_message':          'mail',

  'compliance.document_expiring':   'file-warning',
  'compliance.hs_incident':         'shield-alert',
  'fleet.license_expiring':         'car',
  'fleet.parking_violation':        'map-pin-off',
  'fleet.parking_change_requested': 'map-pin',
  'fleet.parking_change_decided':   'car',
  'fleet.tracking_pull_failed':     'satellite-off',
  'fleet.tracking_data_gap':        'chart-line-off',
  'fleet.tracking_pull_degraded':   'satellite-off',
  'fleet.operational_incident_opened': 'triangle-alert',
  'fleet.operational_incident_escalated': 'siren',
  'fleet.operational_incident_resolved': 'circle-check',
  'fleet.operational_morning_summary': 'clipboard-list',
  'fleet.operational_monitor_failed': 'circle-x',
  'attendance.clockout_due':        'clock',
  'attendance.correction_required': 'alert-circle',
  'attendance.supervisor_digest':   'clipboard-list',
  'attendance.hr_readiness':        'calendar-check',
};

// =============================================================================
// Event Severity Levels
// =============================================================================

export const EVENT_SEVERITY: Record<string, NotificationSeverity> = {
  'noc.ticket_assigned':    'info',
  'noc.ticket_stepped':     'info',
  'noc.ticket_transferred': 'warning',
  'noc.qa_rejected':        'error',
  'noc.qa_approved':        'success',
  'noc.escalation_created': 'error',
  'noc.sla_warning':        'warning',
  'noc.ticket_closed':      'success',
  'noc.ticket_team_assigned': 'info',
  'noc.ticket_status_changed': 'info',
  'noc.ticket_unassigned':    'warning',

  'activate.qa_rejected':           'error',
  'activate.qa_approved':           'success',

  'project.staff_assigned':         'info',
  'project.staff_removed':          'warning',
  'project.pm_changed':             'info',
  'project.status_changed':         'info',

  'procurement.approval_needed':    'warning',
  'procurement.approved':           'success',
  'procurement.rejected':           'error',

  'messaging.new_message':          'info',

  'compliance.document_expiring':   'warning',
  'compliance.hs_incident':         'error',
  'fleet.license_expiring':         'warning',
  'fleet.parking_violation':        'warning',
  'fleet.parking_change_requested': 'info',
  'fleet.parking_change_decided':   'info',
  'fleet.tracking_pull_failed':     'warning',
  'fleet.tracking_data_gap':        'warning',
  'fleet.tracking_pull_degraded':   'warning',
  'fleet.operational_incident_opened': 'warning',
  'fleet.operational_incident_escalated': 'error',
  'fleet.operational_incident_resolved': 'success',
  'fleet.operational_morning_summary': 'info',
  'fleet.operational_monitor_failed': 'error',
  'attendance.clockout_due':        'warning',
  'attendance.correction_required': 'warning',
  'attendance.supervisor_digest':   'warning',
  'attendance.hr_readiness':        'info',
};

// =============================================================================
// Event Labels (human-readable names for preferences UI)
// =============================================================================

export const EVENT_LABELS: Record<string, string> = {
  'noc.ticket_assigned':    'Ticket Assigned',
  'noc.ticket_stepped':     'Ticket Step Changed',
  'noc.ticket_transferred': 'Ticket Transferred',
  'noc.qa_rejected':        'NOC QA Rejected',
  'noc.qa_approved':        'NOC QA Approved',
  'noc.escalation_created': 'Escalation Created',
  'noc.sla_warning':        'SLA Warning',
  'noc.ticket_closed':      'Ticket Closed',
  'noc.ticket_team_assigned': 'Ticket Assigned to Team',
  'noc.ticket_status_changed': 'Ticket Status Changed',
  'noc.ticket_unassigned':    'Ticket Unassigned',

  'activate.qa_rejected':           'Activate QA Rejected',
  'activate.qa_approved':           'Activate QA Approved',

  'project.staff_assigned':         'Staff Assigned to Project',
  'project.staff_removed':          'Staff Removed from Project',
  'project.pm_changed':             'Project Manager Changed',
  'project.status_changed':         'Project Status Changed',

  'procurement.approval_needed':    'Approval Needed',
  'procurement.approved':           'PO Approved',
  'procurement.rejected':           'PO Rejected',

  'messaging.new_message':          'New Message',

  'compliance.document_expiring':   'Document Expiring',
  'compliance.hs_incident':         'H&S Incident Reported',
  'fleet.license_expiring':         'Vehicle License Expiring',
  'fleet.parking_violation':        'Vehicle Not At Declared Address',
  'fleet.parking_change_requested': 'Parking Address Change Requested',
  'fleet.parking_change_decided':   'Parking Address Request Decided',
  'fleet.tracking_pull_failed':     'Vehicle Tracking Pull Failed',
  'fleet.tracking_data_gap':        'Vehicle Tracking Data Gap',
  'fleet.tracking_pull_degraded':   'Vehicle Tracking Degraded',
  'fleet.operational_incident_opened': 'Operational Incident Opened',
  'fleet.operational_incident_escalated': 'Operational Incident Escalated',
  'fleet.operational_incident_resolved': 'Operational Incident Resolved',
  'fleet.operational_morning_summary': 'Operational Morning Summary',
  'fleet.operational_monitor_failed': 'Operational Monitor Failed',
  'attendance.clockout_due':        'Clock-out Required',
  'attendance.correction_required': 'Attendance Correction Required',
  'attendance.supervisor_digest':   'Supervisor Attendance Digest',
  'attendance.hr_readiness':        'HR Attendance Readiness',
};

// =============================================================================
// Event Groups (for preferences UI grouping)
// =============================================================================

export const EVENT_GROUPS: Record<string, string> = {
  'noc.ticket_assigned':    'NOC',
  'noc.ticket_stepped':    'NOC',
  'noc.ticket_transferred':    'NOC',
  'noc.qa_rejected':    'NOC',
  'noc.qa_approved':    'NOC',
  'noc.escalation_created':    'NOC',
  'noc.sla_warning':    'NOC',
  'noc.ticket_closed':    'NOC',
  'noc.ticket_team_assigned':    'NOC',
  'noc.ticket_status_changed':    'NOC',
  'noc.ticket_unassigned':    'NOC',

  'activate.qa_rejected':           'QA / Activate',
  'activate.qa_approved':           'QA / Activate',

  'project.staff_assigned':         'Projects',
  'project.staff_removed':          'Projects',
  'project.pm_changed':             'Projects',
  'project.status_changed':         'Projects',

  'procurement.approval_needed':    'Procurement',
  'procurement.approved':           'Procurement',
  'procurement.rejected':           'Procurement',

  'messaging.new_message':          'Messaging',

  'compliance.document_expiring':   'Compliance',
  'compliance.hs_incident':         'Compliance',
  'fleet.license_expiring':         'Fleet',
  'fleet.parking_violation':        'Fleet',
  'fleet.parking_change_requested': 'Fleet',
  'fleet.parking_change_decided':   'Fleet',
  'fleet.tracking_pull_failed':     'Fleet',
  'fleet.tracking_data_gap':        'Fleet',
  'fleet.tracking_pull_degraded':   'Fleet',
  'fleet.operational_incident_opened': 'Fleet',
  'fleet.operational_incident_escalated': 'Fleet',
  'fleet.operational_incident_resolved': 'Fleet',
  'fleet.operational_morning_summary': 'Fleet',
  'fleet.operational_monitor_failed': 'Fleet',
  'attendance.clockout_due':        'Attendance',
  'attendance.correction_required': 'Attendance',
  'attendance.supervisor_digest':   'Attendance',
  'attendance.hr_readiness':        'Attendance',
};

/** Get all registered event types (excluding _fallback) */
export function getRegisteredEventTypes(): string[] {
  return Object.keys(DEFAULT_CHANNEL_PREFERENCES).filter(k => k !== '_fallback');
}

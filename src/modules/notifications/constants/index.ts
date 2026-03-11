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
};

/** Get all registered event types (excluding _fallback) */
export function getRegisteredEventTypes(): string[] {
  return Object.keys(DEFAULT_CHANNEL_PREFERENCES).filter(k => k !== '_fallback');
}

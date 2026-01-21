/**
 * Pipeline Activity Log Types
 * Tracks all actions and changes on pipeline projects
 */

// ============================================================================
// Enums
// ============================================================================

export type PipelineAction =
  // Project actions
  | 'project_created'
  | 'project_updated'
  | 'status_changed'
  | 'assigned'
  | 'priority_changed'

  // Approval actions
  | 'approval_added'
  | 'approval_removed'
  | 'approval_updated'
  | 'approval_submitted'
  | 'approval_approved'
  | 'approval_rejected'
  | 'approval_expired'
  | 'approval_renewed'
  | 'approval_withdrawn'

  // Internal approval
  | 'internal_pm_approved'
  | 'internal_ops_approved'
  | 'internal_rejected'

  // Documents
  | 'document_uploaded'
  | 'document_verified'
  | 'document_deleted'

  // Follow-ups
  | 'followup_scheduled'
  | 'followup_completed'
  | 'followup_overdue'

  // PO
  | 'po_received'
  | 'po_updated'

  // Transition
  | 'transitioned_to_planned'
  | 'transition_cancelled'

  // Sync
  | 'synced_from_smartsheet'
  | 'sync_conflict_resolved'
  | 'manual_override'
  | 'sync_error'

  // Alerts
  | 'expiry_alert_sent'
  | 'expiry_alert_acknowledged';

export type ActivitySource = 'manual' | 'smartsheet_sync' | 'system' | 'api' | 'cron';

export type RelatedEntityType = 'document' | 'approval' | 'alert';

// ============================================================================
// Core Types
// ============================================================================

export interface PipelineActivityLog {
  id: string;
  pipeline_project_id: string;
  approval_id: string | null;

  action: PipelineAction;
  action_by: string | null;
  action_at: string;

  // Change tracking
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  field_changed: string | null;
  notes: string | null;

  // Source
  source: ActivitySource;

  // Related entity
  related_entity_type: RelatedEntityType | null;
  related_entity_id: string | null;

  created_at: string;
}

// ============================================================================
// Extended Types
// ============================================================================

export interface PipelineActivityLogWithUser extends PipelineActivityLog {
  action_by_name?: string;
  action_by_email?: string;
}

export interface PipelineActivityLogWithApproval extends PipelineActivityLogWithUser {
  approval_type_code?: string;
  approval_type_name?: string;
}

// ============================================================================
// Query Types
// ============================================================================

export interface ActivityLogFilters {
  pipeline_project_id?: string;
  approval_id?: string;
  action?: PipelineAction | PipelineAction[];
  source?: ActivitySource;
  action_by?: string;
  from_date?: string;
  to_date?: string;
}

export interface ActivityLogQueryParams {
  filters?: ActivityLogFilters;
  page?: number;
  limit?: number;
}

export interface ActivityLogListResponse {
  activities: PipelineActivityLogWithApproval[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// Create Types
// ============================================================================

export interface CreateActivityLogInput {
  pipeline_project_id: string;
  approval_id?: string;
  action: PipelineAction;
  action_by?: string;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  field_changed?: string;
  notes?: string;
  source?: ActivitySource;
  related_entity_type?: RelatedEntityType;
  related_entity_id?: string;
}

// ============================================================================
// Timeline Display Types
// ============================================================================

export interface ActivityTimelineItem {
  id: string;
  action: PipelineAction;
  action_at: string;
  action_by_name: string | null;

  // Display
  title: string; // Human-readable action title
  description: string | null; // Details
  icon: string; // Icon name for UI
  color: 'blue' | 'green' | 'yellow' | 'red' | 'gray';

  // Context
  approval_type_name?: string;
  field_changed?: string;
  old_value_display?: string;
  new_value_display?: string;
}

// Helper to get display properties for an action
export const ACTION_DISPLAY: Record<
  PipelineAction,
  { title: string; icon: string; color: ActivityTimelineItem['color'] }
> = {
  project_created: { title: 'Project Created', icon: 'plus', color: 'green' },
  project_updated: { title: 'Project Updated', icon: 'pencil', color: 'blue' },
  status_changed: { title: 'Status Changed', icon: 'arrow-right', color: 'blue' },
  assigned: { title: 'Assignment Changed', icon: 'user', color: 'blue' },
  priority_changed: { title: 'Priority Changed', icon: 'flag', color: 'yellow' },

  approval_added: { title: 'Approval Added', icon: 'plus-circle', color: 'blue' },
  approval_removed: { title: 'Approval Removed', icon: 'minus-circle', color: 'gray' },
  approval_updated: { title: 'Approval Updated', icon: 'pencil', color: 'blue' },
  approval_submitted: { title: 'Application Submitted', icon: 'send', color: 'blue' },
  approval_approved: { title: 'Approval Granted', icon: 'check-circle', color: 'green' },
  approval_rejected: { title: 'Approval Rejected', icon: 'x-circle', color: 'red' },
  approval_expired: { title: 'Approval Expired', icon: 'clock', color: 'red' },
  approval_renewed: { title: 'Approval Renewed', icon: 'refresh', color: 'green' },
  approval_withdrawn: { title: 'Application Withdrawn', icon: 'undo', color: 'gray' },

  internal_pm_approved: { title: 'PM Approved', icon: 'check', color: 'green' },
  internal_ops_approved: { title: 'Ops Approved', icon: 'check-double', color: 'green' },
  internal_rejected: { title: 'Internal Rejected', icon: 'x', color: 'red' },

  document_uploaded: { title: 'Document Uploaded', icon: 'upload', color: 'blue' },
  document_verified: { title: 'Document Verified', icon: 'badge-check', color: 'green' },
  document_deleted: { title: 'Document Deleted', icon: 'trash', color: 'gray' },

  followup_scheduled: { title: 'Follow-up Scheduled', icon: 'calendar', color: 'blue' },
  followup_completed: { title: 'Follow-up Completed', icon: 'check', color: 'green' },
  followup_overdue: { title: 'Follow-up Overdue', icon: 'alert-triangle', color: 'yellow' },

  po_received: { title: 'PO Received', icon: 'file-text', color: 'green' },
  po_updated: { title: 'PO Updated', icon: 'edit', color: 'blue' },

  transitioned_to_planned: { title: 'Transitioned to Planned', icon: 'arrow-up-right', color: 'green' },
  transition_cancelled: { title: 'Transition Cancelled', icon: 'undo', color: 'yellow' },

  synced_from_smartsheet: { title: 'Synced from Smartsheet', icon: 'refresh', color: 'blue' },
  sync_conflict_resolved: { title: 'Sync Conflict Resolved', icon: 'git-merge', color: 'yellow' },
  manual_override: { title: 'Manual Override', icon: 'edit-2', color: 'yellow' },
  sync_error: { title: 'Sync Error', icon: 'alert-circle', color: 'red' },

  expiry_alert_sent: { title: 'Expiry Alert Sent', icon: 'bell', color: 'yellow' },
  expiry_alert_acknowledged: { title: 'Alert Acknowledged', icon: 'check', color: 'green' },
};

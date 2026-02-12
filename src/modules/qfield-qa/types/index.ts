/**
 * QField QA Types
 */

export type WorkflowStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'escalated';
export type ManualStatus = 'approved' | 'rejected' | null;
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type WorkType = 'pole_installation' | 'cable_stringing' | 'dome_joint' | 'activation';
export type FeatureType = 'pole' | 'drop' | 'splice' | 'cable';
export type ActionType = 'assign' | 'approve' | 'reject' | 'escalate' | 'revalidate' | 'comment';

export interface PhotoValidation {
  id: string;
  photo_key: string;
  feature_id: string | null;
  feature_type: FeatureType | null;
  work_type: WorkType | null;
  project_id: string | null;

  // VLM validation results
  vlm_confidence: number | null;
  vlm_feedback: string | null;
  vlm_raw_response: VLMResponse | null;

  // Retake tracking
  needs_retake: boolean;
  retake_notified_at: string | null;
  retake_completed_at: string | null;

  // Manual review
  manual_status: ManualStatus;
  manual_reviewed_by: string | null;
  manual_reviewed_at: string | null;
  manual_notes: string | null;

  // Assignment
  assigned_to: string | null;
  assigned_at: string | null;
  due_date: string | null;
  priority: Priority;

  // Escalation
  escalation_level: number;
  escalated_at: string | null;
  escalation_reason: string | null;

  // Workflow
  workflow_status: WorkflowStatus;
  validated_at: string | null;
  created_at: string;

  // File metadata
  file_size_bytes: number | null;
  file_modified_at: string | null;

  // Joined pole context
  pole_type?: string | null;
  pole_height?: number | null;
  pole_material?: string | null;
  pole_status?: string | null;
  pole_latitude?: number | null;
  pole_longitude?: number | null;
  pole_address?: string | null;
  pole_images?: string[] | null;
  pole_zone_no?: number | null;
  pole_pon_no?: number | null;

  // Joined drop context
  drop_number?: string | null;
  drop_pole_number?: string | null;
  drop_address?: string | null;
  drop_customer_name?: string | null;
  drop_status?: string | null;
  drop_qc_status?: string | null;

  // Joined project context
  qfield_project_name?: string | null;
}

export interface VLMResponse {
  valid: boolean;
  confidence: number;
  issues: string[];
  feedback: string;
}

export interface QAStats {
  summary: {
    total: number;
    pending: number;
    in_review: number;
    approved: number;
    rejected: number;
    escalated: number;
    overdue: number;
    needs_retake: number;
    my_queue: number;
  };
  ai_confidence: {
    not_validated: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
  };
  by_work_type: Array<{
    work_type: WorkType | 'unknown';
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    avg_confidence: string | null;
  }>;
  by_priority: {
    low: number;
    normal: number;
    high: number;
    urgent: number;
  };
  recent_activity: Array<{
    action_type: ActionType;
    action_by: string;
    action_at: string;
    notes: string | null;
  }>;
}

export interface QAProject {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sync_enabled: boolean;
  validation_count: number;
  pending_count: number;
  needs_retake_count: number;
}

export interface QAAssignment {
  id: string;
  validation_id: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: string;
  due_date: string | null;
  priority: Priority;
  notes: string | null;
  completed_at: string | null;
  photo_key?: string;
  work_type?: WorkType;
  workflow_status?: WorkflowStatus;
}

export interface QAFilters {
  projectId?: string;
  workType?: WorkType;
  workflowStatus?: WorkflowStatus;
  assignedTo?: string;
  priority?: Priority;
  needsRetake?: boolean;
  search?: string;
  zoneNo?: number;
  ponNo?: number;
  featureType?: string;
  page?: number;
  pageSize?: number;
}

export interface QAHierarchyFeatureType {
  work_type: string;
  photo_count: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface QAHierarchyPon {
  pon_no: number | null;
  photo_count: number;
  pending: number;
  approved: number;
  rejected: number;
  feature_types: QAHierarchyFeatureType[];
}

export interface QAHierarchyZone {
  zone_no: number | null;
  photo_count: number;
  pending: number;
  approved: number;
  rejected: number;
  pons: QAHierarchyPon[];
}

export interface QAHierarchy {
  zones: QAHierarchyZone[];
  totals: {
    photo_count: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

export interface ActionRequest {
  action: ActionType;
  validationIds: string[];
  notes?: string;
  assignee?: string;
  dueDate?: string;
  priority?: Priority;
  escalationReason?: string;
}

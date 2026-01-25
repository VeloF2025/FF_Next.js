/**
 * Pipeline Approval Types
 * Tracks individual approval gates per project (wayleave, municipal, etc.)
 */

// ============================================================================
// Enums
// ============================================================================

export type ApprovalCategory =
  | 'wayleave'
  | 'municipal'
  | 'environmental'
  | 'traditional'
  | 'other';

export type ApprovalStatus =
  | 'not_started'
  | 'preparing'
  | 'internal_review'
  | 'submitted'
  | 'in_review'
  | 'additional_info_required'
  | 'approved'
  | 'conditionally_approved'
  | 'rejected'
  | 'expired'
  | 'renewed'
  | 'withdrawn';

export type InternalApprovalStatus =
  | 'pending'
  | 'pm_approved'
  | 'ops_approved'
  | 'rejected';

export type ApprovalDocumentType =
  | 'application_form'
  | 'supporting_doc'
  | 'site_plan'
  | 'route_map'
  | 'approval_certificate'
  | 'rejection_letter'
  | 'conditions_doc'
  | 'fee_receipt'
  | 'correspondence'
  | 'appeal_doc'
  | 'other';

export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'upcoming' | 'ok';

export type FollowupStatus = 'overdue' | 'today' | 'upcoming' | 'scheduled';

// ============================================================================
// Approval Type Configuration
// ============================================================================

export type ApprovalConditionType = 'rural_only' | 'urban_only' | null;

export interface PipelineApprovalType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: ApprovalCategory;
  default_required: boolean;
  is_compulsory: boolean;
  condition_type: ApprovalConditionType;
  typical_duration_days: number | null;
  default_authority_name: string | null;
  default_authority_contact: string | null;
  required_documents: ApprovalTypeDocument[];
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApprovalTypeDocument {
  type: ApprovalDocumentType;
  name: string;
  required: boolean;
}

// ============================================================================
// Project Approval Instance
// ============================================================================

export interface PipelineProjectApproval {
  id: string;
  pipeline_project_id: string;
  approval_type_id: string;
  service_authority_id: string | null;

  // Status
  status: ApprovalStatus;
  is_required: boolean;

  // Application
  application_date: string | null;
  application_reference: string | null;
  application_document_url: string | null;

  // Authority
  authority_name: string | null;
  authority_contact_name: string | null;
  authority_contact_email: string | null;
  authority_contact_phone: string | null;
  authority_address: string | null;
  assigned_officer: string | null;

  // Follow-up
  last_followup_date: string | null;
  next_followup_date: string | null;
  followup_count: number;
  followup_notes: string | null;

  // Approval details
  approval_date: string | null;
  approval_reference: string | null;
  approval_document_url: string | null;
  issue_date: string | null;
  expiry_date: string | null;

  // Financial
  application_fee: number | null;
  fee_paid: boolean;
  fee_paid_date: string | null;
  fee_receipt_reference: string | null;
  fee_receipt_url: string | null;

  // Coverage
  coverage_description: string | null;
  affected_coordinates: ApprovalCoordinates | null;
  conditions: string | null;

  // Rejection
  rejection_date: string | null;
  rejection_reason: string | null;
  appeal_submitted: boolean;
  appeal_date: string | null;
  appeal_reference: string | null;

  // Internal approval (2-level)
  internal_status: InternalApprovalStatus;
  pm_approved_by: string | null;
  pm_approved_at: string | null;
  pm_notes: string | null;
  ops_approved_by: string | null;
  ops_approved_at: string | null;
  ops_notes: string | null;
  internal_rejected_by: string | null;
  internal_rejected_at: string | null;
  internal_rejection_reason: string | null;

  // Smartsheet
  smartsheet_columns: Record<string, string> | null;
  last_synced_at: string | null;

  // Notes
  notes: string | null;

  // Audit
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface ApprovalCoordinates {
  route_segments?: Array<{
    start: { lat: number; lng: number };
    end: { lat: number; lng: number };
  }>;
  affected_areas?: Array<{ lat: number; lng: number }>;
  coverage_polygon?: Array<{ lat: number; lng: number }>;
}

// ============================================================================
// Extended Types
// ============================================================================

export interface PipelineProjectApprovalWithType extends PipelineProjectApproval {
  approval_type_code: string;
  approval_type_name: string;
  approval_type_category: ApprovalCategory;
  approval_type_is_compulsory: boolean;
  approval_type_condition_type: ApprovalConditionType;
}

export interface ExpiringApproval extends PipelineProjectApprovalWithType {
  project_code: string | null;
  project_name: string;
  client_id: string | null;
  client_name: string | null;
  project_manager_id: string | null;
  wayleaves_officer_id: string | null;
  days_until_expiry: number;
  urgency: ExpiryUrgency;
}

export interface DueFollowup extends PipelineProjectApprovalWithType {
  project_code: string | null;
  project_name: string;
  project_manager_id: string | null;
  wayleaves_officer_id: string | null;
  days_until_followup: number;
  followup_status: FollowupStatus;
}

// ============================================================================
// Document Types
// ============================================================================

export interface PipelineApprovalDocument {
  id: string;
  approval_id: string;
  pipeline_project_id: string;

  document_type: ApprovalDocumentType;
  document_name: string;
  description: string | null;

  file_name: string;
  file_path: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;

  document_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;

  reference_number: string | null;
  issuing_authority: string | null;

  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;

  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

// ============================================================================
// Alert Types
// ============================================================================

export type AlertType = '90_day' | '30_day' | '7_day' | 'expired';

export interface PipelineExpiryAlert {
  id: string;
  approval_id: string;
  pipeline_project_id: string;

  alert_type: AlertType;
  alert_date: string;
  expiry_date: string;

  is_sent: boolean;
  sent_at: string | null;
  sent_to: AlertRecipient[];
  send_error: string | null;

  acknowledged_by: string | null;
  acknowledged_at: string | null;
  action_taken: string | null;

  created_at: string;
}

export interface AlertRecipient {
  user_id: string;
  email: string;
  method: 'email' | 'in_app' | 'whatsapp';
  sent_at: string;
}

// ============================================================================
// Form Types
// ============================================================================

export interface CreateApprovalInput {
  pipeline_project_id: string;
  approval_type_id: string;
  service_authority_id?: string;
  is_required?: boolean;
  authority_name?: string;
  authority_contact_name?: string;
  authority_contact_email?: string;
  authority_contact_phone?: string;
  authority_address?: string;
  notes?: string;
  created_by?: string;
}

export interface UpdateApprovalInput {
  status?: ApprovalStatus;
  is_required?: boolean;
  service_authority_id?: string | null;

  // Application
  application_date?: string | null;
  application_reference?: string | null;
  application_document_url?: string | null;

  // Authority
  authority_name?: string | null;
  authority_contact_name?: string | null;
  authority_contact_email?: string | null;
  authority_contact_phone?: string | null;
  authority_address?: string | null;
  assigned_officer?: string | null;

  // Follow-up
  next_followup_date?: string | null;
  followup_notes?: string | null;

  // Approval
  approval_date?: string | null;
  approval_reference?: string | null;
  approval_document_url?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;

  // Financial
  application_fee?: number | null;
  fee_paid?: boolean;
  fee_paid_date?: string | null;
  fee_receipt_reference?: string | null;
  fee_receipt_url?: string | null;

  // Coverage
  coverage_description?: string | null;
  affected_coordinates?: ApprovalCoordinates | null;
  conditions?: string | null;

  // Notes
  notes?: string | null;

  updated_by?: string;
}

export interface SubmitApplicationInput {
  application_date: string;
  application_reference?: string;
  application_document_url?: string;
  application_fee?: number;
  notes?: string;
  updated_by: string;
}

export interface ApproveApprovalInput {
  approval_date: string;
  approval_reference: string;
  approval_document_url?: string;
  issue_date?: string;
  expiry_date?: string;
  conditions?: string;
  notes?: string;
  updated_by: string;
}

export interface RejectApprovalInput {
  rejection_date: string;
  rejection_reason: string;
  notes?: string;
  updated_by: string;
}

export interface InternalApproveInput {
  action: 'pm_approve' | 'ops_approve' | 'reject';
  notes?: string;
  rejection_reason?: string; // Required if action is 'reject'
  approved_by: string;
}

export interface ScheduleFollowupInput {
  next_followup_date: string;
  followup_notes?: string;
  updated_by: string;
}

export interface CompleteFollowupInput {
  followup_notes: string;
  next_followup_date?: string; // Schedule another if needed
  updated_by: string;
}

// ============================================================================
// Document Form Types
// ============================================================================

export interface UploadApprovalDocumentInput {
  approval_id: string;
  document_type: ApprovalDocumentType;
  document_name: string;
  description?: string;
  file_name: string;
  file_path?: string;
  file_url?: string;
  file_size?: number;
  mime_type?: string;
  document_date?: string;
  issue_date?: string;
  expiry_date?: string;
  reference_number?: string;
  issuing_authority?: string;
  uploaded_by: string;
}

export interface VerifyDocumentInput {
  is_verified: boolean;
  verification_notes?: string;
  verified_by: string;
}

// ============================================================================
// Query Types
// ============================================================================

export interface ApprovalFilters {
  status?: ApprovalStatus | ApprovalStatus[];
  internal_status?: InternalApprovalStatus | InternalApprovalStatus[];
  approval_type_id?: string;
  category?: ApprovalCategory;
  is_required?: boolean;
  has_expiry?: boolean;
  expiring_within_days?: number;
  followup_due?: boolean;
}

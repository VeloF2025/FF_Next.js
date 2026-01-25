/**
 * Pipeline Project Types
 * Tracks potential projects through approval pipeline until PO received
 */

// ============================================================================
// Enums
// ============================================================================

export type PipelineStatus =
  | 'new'
  | 'qualification'
  | 'approvals_in_progress'
  | 'approvals_complete'
  | 'po_pending'
  | 'ready_to_plan'
  | 'planned'
  | 'on_hold'
  | 'cancelled'
  | 'lost';

export type ProjectType = 'greenfield' | 'brownfield' | 'extension' | 'upgrade';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';

// Lease and Cession status types
export type LeaseStatus = 'not_started' | 'in_progress' | 'signed' | 'received';
export type CessionStatus = 'not_started' | 'signed' | 'received';

// ============================================================================
// Core Types
// ============================================================================

export interface PipelineProjectCoordinates {
  lat: number;
  lng: number;
  polygon?: Array<{ lat: number; lng: number }>;
}

export interface PipelineProject {
  id: string;

  // Identification
  project_code: string | null;
  project_name: string;
  description: string | null;

  // Location
  province: string | null;
  municipality: string | null;
  area: string | null;
  address: string | null;
  coordinates: PipelineProjectCoordinates | null;

  // Classification
  project_type: ProjectType;
  priority: Priority;

  // Client
  client_id: string | null;
  client_contact_name: string | null;
  client_contact_email: string | null;
  client_contact_phone: string | null;

  // Internal Assignment
  project_manager_id: string | null;
  wayleaves_officer_id: string | null;
  operations_manager_id: string | null;

  // Smartsheet Sync
  smartsheet_id: string | null;
  smartsheet_sheet_id: string | null;
  last_synced_at: string | null;
  sync_status: SyncStatus;
  sync_overrides: string[];

  // Pipeline Status
  pipeline_status: PipelineStatus;

  // Financial Estimates
  estimated_value: number | null;
  estimated_homes_passed: number | null;
  estimated_km: number | null;
  currency: string;

  // Target Dates
  target_start_date: string | null;
  target_completion_date: string | null;

  // PO Information
  po_number: string | null;
  po_date: string | null;
  po_value: number | null;
  po_document_url: string | null;
  po_received_at: string | null;
  po_received_by: string | null;

  // Transition
  planned_project_id: string | null;
  transitioned_at: string | null;
  transitioned_by: string | null;

  // Legal Documents
  lease_agreement_status: LeaseStatus;
  lease_agreement_date: string | null;
  lease_agreement_document_url: string | null;
  lease_agreement_notes: string | null;
  cession_status: CessionStatus;
  cession_date: string | null;
  cession_document_url: string | null;
  cession_notes: string | null;

  // Rural flag (for conditional services like Tribal Authority)
  is_rural: boolean;

  // Additional
  notes: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;

  // Audit
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

// ============================================================================
// Extended Types (with joins)
// ============================================================================

export interface PipelineProjectWithRelations extends PipelineProject {
  // Client info
  client_name?: string;

  // Staff info
  project_manager_name?: string;
  wayleaves_officer_name?: string;
  operations_manager_name?: string;

  // Approval summary
  total_required_approvals?: number;
  completed_approvals?: number;
  expired_approvals?: number;
  earliest_expiry_date?: string | null;

  // Computed
  approval_progress_percent?: number;
}

export interface PipelineProjectSummary {
  id: string;
  project_code: string | null;
  project_name: string;
  client_name: string | null;
  province: string | null;
  municipality: string | null;
  pipeline_status: PipelineStatus;
  priority: Priority;
  estimated_value: number | null;
  total_required_approvals: number;
  completed_approvals: number;
  expired_approvals: number;
  earliest_expiry_date: string | null;
  project_manager_name: string | null;
  created_at: string;
}

// ============================================================================
// Form Types
// ============================================================================

export interface CreatePipelineProjectInput {
  project_name: string;
  description?: string;
  province?: string;
  municipality?: string;
  area?: string;
  address?: string;
  coordinates?: PipelineProjectCoordinates;
  project_type?: ProjectType;
  priority?: Priority;
  client_id?: string;
  client_contact_name?: string;
  client_contact_email?: string;
  client_contact_phone?: string;
  project_manager_id?: string;
  wayleaves_officer_id?: string;
  operations_manager_id?: string;
  estimated_value?: number;
  estimated_homes_passed?: number;
  estimated_km?: number;
  target_start_date?: string;
  target_completion_date?: string;
  is_rural?: boolean;
  notes?: string;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  created_by?: string;
}

export interface UpdatePipelineProjectInput {
  project_name?: string;
  description?: string;
  province?: string;
  municipality?: string;
  area?: string;
  address?: string;
  coordinates?: PipelineProjectCoordinates;
  project_type?: ProjectType;
  priority?: Priority;
  client_id?: string | null;
  client_contact_name?: string;
  client_contact_email?: string;
  client_contact_phone?: string;
  project_manager_id?: string | null;
  wayleaves_officer_id?: string | null;
  operations_manager_id?: string | null;
  pipeline_status?: PipelineStatus;
  estimated_value?: number | null;
  estimated_homes_passed?: number | null;
  estimated_km?: number | null;
  target_start_date?: string | null;
  target_completion_date?: string | null;
  // Legal documents
  lease_agreement_status?: LeaseStatus;
  lease_agreement_date?: string | null;
  lease_agreement_document_url?: string | null;
  lease_agreement_notes?: string | null;
  cession_status?: CessionStatus;
  cession_date?: string | null;
  cession_document_url?: string | null;
  cession_notes?: string | null;
  is_rural?: boolean;
  notes?: string;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  updated_by?: string;
}

export interface ReceivePOInput {
  po_number: string;
  po_date: string;
  po_value: number;
  po_document_url?: string;
  po_received_by: string;
}

export interface TransitionToPlannedInput {
  transitioned_by: string;
  notes?: string;
  // Fields to create in projects table
  project_manager_id?: string;
  start_date?: string;
  end_date?: string;
  budget_allocated?: number;
}

// ============================================================================
// Query Types
// ============================================================================

export interface PipelineProjectFilters {
  search?: string;
  pipeline_status?: PipelineStatus | PipelineStatus[];
  priority?: Priority | Priority[];
  client_id?: string;
  project_manager_id?: string;
  wayleaves_officer_id?: string;
  province?: string;
  municipality?: string;
  project_type?: ProjectType;
  has_po?: boolean;
  has_expired_approvals?: boolean;
  created_after?: string;
  created_before?: string;
}

export interface PipelineProjectSort {
  field:
    | 'project_name'
    | 'project_code'
    | 'pipeline_status'
    | 'priority'
    | 'estimated_value'
    | 'created_at'
    | 'updated_at'
    | 'earliest_expiry_date';
  direction: 'asc' | 'desc';
}

export interface PipelineProjectQueryParams {
  filters?: PipelineProjectFilters;
  sort?: PipelineProjectSort;
  page?: number;
  limit?: number;
}

export interface PipelineProjectListResponse {
  projects: PipelineProjectSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface PipelineDashboardStats {
  total_projects: number;
  by_status: Record<PipelineStatus, number>;
  by_priority: Record<Priority, number>;
  total_estimated_value: number;
  projects_with_expired_approvals: number;
  projects_ready_to_plan: number;
  projects_awaiting_po: number;
  approvals_expiring_soon: number; // next 30 days
}

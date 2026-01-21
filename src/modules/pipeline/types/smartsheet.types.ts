/**
 * Smartsheet Integration Types
 * Configuration and sync tracking for Smartsheet integration
 */

// ============================================================================
// Enums
// ============================================================================

export type SyncDirection = 'from_smartsheet' | 'to_smartsheet' | 'bidirectional';

export type SyncTrigger = 'scheduled' | 'manual' | 'webhook' | 'api';

export type SyncHistoryStatus = 'running' | 'completed' | 'failed' | 'partial' | 'cancelled';

export type SmartsheetColumnType =
  | 'TEXT_NUMBER'
  | 'DATE'
  | 'DATETIME'
  | 'CONTACT_LIST'
  | 'CHECKBOX'
  | 'PICKLIST'
  | 'MULTI_PICKLIST'
  | 'DURATION'
  | 'PREDECESSOR'
  | 'ABSTRACT_DATETIME';

// ============================================================================
// Configuration Types
// ============================================================================

export interface SmartsheetSyncConfig {
  id: string;

  // Sheet identification
  sheet_id: string;
  sheet_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;

  // Sync settings
  is_active: boolean;
  sync_direction: SyncDirection;
  sync_frequency_minutes: number;

  // Last sync info
  last_sync_at: string | null;
  last_sync_status: SyncHistoryStatus | null;
  last_sync_error: string | null;
  last_sync_rows_processed: number | null;

  // Mappings
  column_mappings: ColumnMappings;
  status_mappings: StatusMappings;

  // Filtering
  filter_column_id: string | null;
  filter_values: string[] | null;

  // API
  api_token_env_var: string;

  // Audit
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface ColumnMappings {
  [fieldName: string]: ColumnMapping;
}

export interface ColumnMapping {
  ss_column_id: string;
  ss_column_name: string;
  ss_column_type?: SmartsheetColumnType;

  // For approval-specific fields
  approval_type?: string; // e.g., 'wayleave_eskom'
  field?: string; // e.g., 'status', 'expiry_date'
}

export interface StatusMappings {
  [smartsheetValue: string]: string; // SS value -> our value
}

// ============================================================================
// Sync History Types
// ============================================================================

export interface SmartsheetSyncHistory {
  id: string;
  config_id: string;

  sync_started_at: string;
  sync_completed_at: string | null;
  duration_ms: number | null;

  status: SyncHistoryStatus;

  // Statistics
  rows_processed: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_errored: number;

  // Details
  error_details: SyncError[];
  warnings: SyncWarning[];
  sync_log: string | null;

  // Trigger
  triggered_by: SyncTrigger;
  triggered_by_user: string | null;
}

export interface SyncError {
  row_id?: string;
  ss_row_id: string;
  error: string;
  field?: string;
}

export interface SyncWarning {
  row_id?: string;
  ss_row_id: string;
  message: string;
  field?: string;
}

// ============================================================================
// Form Types
// ============================================================================

export interface CreateSyncConfigInput {
  sheet_id: string;
  sheet_name?: string;
  workspace_id?: string;
  workspace_name?: string;
  sync_direction?: SyncDirection;
  sync_frequency_minutes?: number;
  column_mappings: ColumnMappings;
  status_mappings?: StatusMappings;
  filter_column_id?: string;
  filter_values?: string[];
  created_by?: string;
}

export interface UpdateSyncConfigInput {
  sheet_name?: string;
  is_active?: boolean;
  sync_direction?: SyncDirection;
  sync_frequency_minutes?: number;
  column_mappings?: ColumnMappings;
  status_mappings?: StatusMappings;
  filter_column_id?: string | null;
  filter_values?: string[] | null;
  updated_by?: string;
}

// ============================================================================
// API Types (Smartsheet SDK responses - simplified)
// ============================================================================

export interface SmartsheetColumn {
  id: number;
  title: string;
  type: SmartsheetColumnType;
  index: number;
  options?: string[]; // For picklists
}

export interface SmartsheetRow {
  id: number;
  rowNumber: number;
  cells: SmartsheetCell[];
  createdAt?: string;
  modifiedAt?: string;
}

export interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean | null;
  displayValue?: string;
}

export interface SmartsheetSheet {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
  totalRowCount: number;
}

// ============================================================================
// Sync Operation Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  historyId: string;
  stats: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errored: number;
  };
  errors: SyncError[];
  warnings: SyncWarning[];
  duration_ms: number;
}

export interface MappedProjectData {
  // Project fields
  project_name?: string;
  description?: string;
  province?: string;
  municipality?: string;
  area?: string;
  estimated_value?: number;
  estimated_homes_passed?: number;

  // Approval fields (by approval_type code)
  approvals?: {
    [approvalTypeCode: string]: {
      status?: string;
      expiry_date?: string;
      application_date?: string;
      reference?: string;
    };
  };

  // Metadata
  smartsheet_id: string;
  smartsheet_row_number: number;
}

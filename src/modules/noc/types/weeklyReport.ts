/**
 * Maintenance Module - Weekly Report Import Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for weekly report Excel imports, batch
 * processing, and import tracking.
 */

/**
 * Weekly Report Status
 */
export enum WeeklyReportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Weekly Report Interface
 * Tracks Excel file imports and batch processing
 */
export interface WeeklyReport {
  // Primary identification
  id: string; // UUID
  report_uid: string; // e.g., WR2024-W51

  // Report details
  week_number: number;
  year: number;
  report_date: Date;

  // Source file
  original_filename: string | null;
  file_path: string | null;

  // Import statistics
  total_rows: number | null;
  imported_count: number | null;
  skipped_count: number | null;
  error_count: number | null;
  errors: ImportError[] | null; // JSONB array

  // Status
  status: WeeklyReportStatus;

  // Import metadata
  imported_at: Date | null;
  imported_by: string | null; // UUID reference to users

  // Timestamp
  created_at: Date;
}

/**
 * Import error detail
 */
export interface ImportError {
  row_number: number;
  error_type: ImportErrorType;
  error_message: string;
  field_name: string | null;
  row_data: Record<string, unknown> | null;
}

/**
 * Import error types
 */
export enum ImportErrorType {
  MISSING_REQUIRED_FIELD = 'missing_required_field',
  INVALID_FORMAT = 'invalid_format',
  DUPLICATE_ENTRY = 'duplicate_entry',
  VALIDATION_FAILED = 'validation_failed',
  DATABASE_ERROR = 'database_error',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * Create weekly report payload
 */
export interface CreateWeeklyReportPayload {
  week_number: number;
  year: number;
  report_date: Date;
  original_filename: string;
  file_path: string;
  imported_by: string; // User ID
}

/**
 * Update weekly report payload
 */
export interface UpdateWeeklyReportPayload {
  status?: WeeklyReportStatus;
  total_rows?: number;
  imported_count?: number;
  skipped_count?: number;
  error_count?: number;
  errors?: ImportError[];
  imported_at?: Date;
}

/**
 * Parsed row from Excel file
 */
export interface ImportRow {
  row_number: number;
  ticket_uid?: string;
  title: string;
  description?: string;
  ticket_type: string;
  priority?: string;
  status?: string;
  dr_number?: string;
  pole_number?: string;
  pon_number?: string;
  zone?: string;
  address?: string;
  assigned_to?: string;
  contractor_name?: string;
  fault_description?: string;
  fault_cause?: string;
  created_date?: string;
  [key: string]: string | number | boolean | undefined; // Allow additional columns
}

/**
 * Excel column mapping
 * Maps Excel column names to ticket fields
 */
export interface ExcelColumnMapping {
  excel_column: string;
  ticket_field: string;
  required: boolean;
  transform?: (value: string | number | boolean | null) => string | number | boolean | null;
  validate?: (value: string | number | boolean | null) => boolean;
}

/**
 * Import preview result
 */
export interface ImportPreviewResult {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  sample_rows: ImportRow[];
  validation_errors: ImportValidationError[];
  column_mapping: ExcelColumnMapping[];
  can_proceed: boolean;
}

/**
 * Import validation error
 */
export interface ImportValidationError {
  row_number: number;
  severity: 'error' | 'warning';
  field_name: string | null;
  message: string;
}

/**
 * Import process request
 */
export interface ImportProcessRequest {
  report_id: string;
  file_path: string;
  column_mapping?: ExcelColumnMapping[];
  skip_duplicates?: boolean;
  dry_run?: boolean; // Preview only, don't actually import
}

/**
 * Import process result
 */
export interface ImportProcessResult {
  report_id: string;
  status: WeeklyReportStatus;
  total_rows: number;
  imported_count: number;
  updated_count: number;      // Number of existing tickets updated
  skipped_count: number;
  error_count: number;
  errors: ImportError[];
  duration_seconds: number;
  tickets_created: string[];  // Array of created ticket IDs
  tickets_updated: string[];  // Array of updated ticket IDs
}

/**
 * Weekly report filters for listing
 */
export interface WeeklyReportFilters {
  status?: WeeklyReportStatus | WeeklyReportStatus[];
  week_number?: number;
  year?: number;
  imported_by?: string;
  imported_after?: Date;
  imported_before?: Date;
}

/**
 * Weekly report list response
 */
export interface WeeklyReportListResponse {
  reports: WeeklyReport[];
  total: number;
  by_status: Record<WeeklyReportStatus, number>;
  total_imported_tickets: number;
}

/**
 * Weekly report statistics
 */
export interface WeeklyReportStats {
  total_imports: number;
  successful_imports: number;
  failed_imports: number;
  total_tickets_imported: number;
  avg_tickets_per_import: number;
  avg_import_duration_seconds: number;
  last_import_date: Date | null;
}

/**
 * Duplicate check result
 */
export interface DuplicateCheckResult {
  is_duplicate: boolean;
  existing_ticket_id: string | null;
  existing_ticket_uid: string | null;
  match_field: string | null; // Which field matched
  confidence: number; // 0-1
}

/**
 * Import batch configuration
 */
export interface ImportBatchConfig {
  batch_size: number; // Number of rows to process at once
  concurrent_batches: number;
  timeout_per_batch_seconds: number;
  retry_failed_rows: boolean;
  max_retries: number;
}

/**
 * Import progress update
 */
export interface ImportProgressUpdate {
  report_id: string;
  total_rows: number;
  processed_rows: number;
  imported_count: number;
  error_count: number;
  progress_percentage: number;
  estimated_time_remaining_seconds: number;
  current_batch: number;
  total_batches: number;
}

/**
 * Excel file upload response
 */
export interface ExcelFileUploadResponse {
  file_path: string;
  original_filename: string;
  file_size_bytes: number;
  uploaded_at: Date;
  uploaded_by: string;
}

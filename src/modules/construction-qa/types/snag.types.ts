/**
 * Snags Module — TypeScript Interfaces
 *
 * Maps to: snag_reports, snags, snag_photos tables.
 * All dates are ISO strings (SAST UTC+2).
 */

// ============================================================
// Union Types
// ============================================================

export type SnagStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'fixed'
  | 'verified'
  | 'closed'
  | 'reopened'
  | 'wont_fix'
  | 'duplicate';

export type SnagCategory =
  | 'quality'
  | 'health'
  | 'safety'
  | 'environment'
  | 'traffic';

export type SnagSeverity = 'critical' | 'major' | 'minor';

export type SnagPhase = 'before' | 'during' | 'after';

export type SnagPhotoSource =
  | 'tqr_import'
  | 'noc_upload'
  | 'manual'
  | 'whatsapp';

export type SnagImportStatus = 'pending' | 'processing' | 'complete' | 'failed';

// ============================================================
// Core Entities
// ============================================================

/** Maps to snag_reports table */
export interface SnagReport {
  id: string;
  project_id: string;
  project_name?: string;
  report_number: string;
  site_name: string | null;
  client: string | null;
  contractor: string | null;
  audit_date: string;
  auditor: string | null;
  source_pdf_url: string | null;
  source_pdf_filename: string | null;

  // Audit scores
  quality_assurance: number;
  quality_nc: number;
  health_assurance: number;
  health_nc: number;
  safety_assurance: number;
  safety_nc: number;
  environment_assurance: number;
  environment_nc: number;
  traffic_assurance: number;
  traffic_nc: number;

  // Metadata
  total_findings: number;
  import_status: SnagImportStatus;
  import_notes: string | null;
  imported_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Maps to snags table */
export interface Snag {
  id: string;
  report_id: string;
  project_id: string;
  snag_number: number;

  // Classification
  category: SnagCategory;
  severity: SnagSeverity;
  description: string;

  // Location
  pole_references: string[] | null;
  pole_ids: string[] | null;
  zone_id: string | null;
  pon_id: string | null;
  drop_id: string | null;

  // Lifecycle
  status: SnagStatus;
  noc_ticket_id: string | null;
  /** Human-readable NOC ticket UID (e.g. SNG-20260402-001), joined from maintenance_tickets */
  noc_ticket_uid?: string | null;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  assigned_at: string | null;
  fix_deadline: string | null;
  fixed_at: string | null;
  fixed_by: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
  closed_at: string | null;

  // Repeat tracking
  is_repeat: boolean;
  repeat_of_snag_id: string | null;
  repeat_count: number;
  reopen_count: number;

  created_at: string;
  updated_at: string;

  // Joined data (flat from SQL JOIN)
  report_number?: string;
  audit_date?: string;
  noc_ticket_uid?: string | null;
  pole_latitude?: string | null;
  pole_longitude?: string | null;
  pole_zone_no?: number | null;
  pole_pon_no?: number | null;
  photos?: SnagPhoto[];
}

/** Maps to snag_photos table */
export interface SnagPhoto {
  id: string;
  snag_id: string;
  phase: SnagPhase;
  photo_url: string;
  thumbnail_url: string | null;
  pole_reference: string | null;
  /** GPS latitude extracted from TQR PDF grid text */
  latitude: number | null;
  /** GPS longitude extracted from TQR PDF grid text */
  longitude: number | null;
  /** Raw timestamp string from TQR PDF, if available */
  photo_timestamp: string | null;
  caption: string | null;
  source: SnagPhotoSource;
  vlm_assessment: Record<string, unknown> | null;
  uploaded_by: string | null;
  created_at: string;
}

// ============================================================
// Dashboard / Statistics
// ============================================================

/** Per-project snag counts for dashboard cards */
export interface SnagProjectStats {
  project_id: string;
  project_name: string;
  total: number;
  open: number;
  assigned: number;
  in_progress: number;
  fixed: number;
  verified: number;
  closed: number;
  reopened: number;
  latest_report_number: string | null;
  latest_report_date: string | null;
  latest_report_id: string | null;
}

// ============================================================
// Pole Resolution
// ============================================================

/** Candidate pole returned by the resolver search */
export interface PoleCandidate {
  id: string;
  pole_number: string;
  zone_no: number | null;
  pon_no: number | null;
}

// ============================================================
// Sort
// ============================================================

export type SnagSortBy =
  | 'newest'
  | 'oldest'
  | 'status'
  | 'severity'
  | 'needs_attention';

// ============================================================
// Filter State
// ============================================================

export interface SnagFilters {
  projectId: string;
  reportId: string;
  status: string;
  category: string;
  severity: string;
  search: string;
  sortBy: SnagSortBy;
  page: number;
  pageSize: number;
}

// ============================================================
// API Request / Response Types
// ============================================================

export interface CreateSnagReportRequest {
  project_id: string;
  report_number: string;
  site_name?: string;
  client?: string;
  contractor?: string;
  audit_date: string;
  auditor?: string;
  source_pdf_url?: string;
  source_pdf_filename?: string;
  quality_assurance?: number;
  quality_nc?: number;
  health_assurance?: number;
  health_nc?: number;
  safety_assurance?: number;
  safety_nc?: number;
  environment_assurance?: number;
  environment_nc?: number;
  traffic_assurance?: number;
  traffic_nc?: number;
}

export interface CreateSnagRequest {
  report_id: string;
  project_id: string;
  snag_number: number;
  category: SnagCategory;
  severity?: SnagSeverity;
  description: string;
  pole_references?: string[];
}

export interface UpdateSnagRequest {
  id: string;
  status?: SnagStatus;
  assigned_to?: string | null;
  severity?: SnagSeverity;
  fix_deadline?: string | null;
  verification_notes?: string;
  noc_ticket_id?: string | null;
}

export interface CreateSnagPhotoRequest {
  snag_id: string;
  phase: SnagPhase;
  photo_url: string;
  thumbnail_url?: string;
  pole_reference?: string;
  caption?: string;
  source: SnagPhotoSource;
}

export interface SnagListResponse {
  snags: Snag[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SnagReportListResponse {
  reports: SnagReport[];
  total: number;
  page: number;
  pageSize: number;
}

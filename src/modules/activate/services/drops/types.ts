/**
 * Shared type definitions for the drops API service layer.
 * Used across dropQueryService, dropStatsService, and dropSyncService.
 */

// 🟢 WORKING: Matches the dr_photo_unified_reviews view + joined columns
export interface UnifiedDrop {
  id: string;
  drop_number: string;
  project: string | null;
  photo_source: string | null;
  photo_count: number;
  photos_metadata: Record<string, unknown>[];
  vlm_categorization_status: string | null;
  vlm_categorization_results: Record<string, unknown>[];
  vlm_categorized_at: string | null;
  feedback_sent: boolean;
  created_at: string;
  updated_at: string;
  onemap_ont_serial: string | null;
  onemap_ups_serial: string | null;
  sender_phone: string | null;
  submitted_date: string | null;
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_entry_outside: boolean;
  step_04_entry_inside: boolean;
  step_05_wall: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_final_installation: boolean;
  step_09_green_lights: boolean;
  step_10_signature: boolean;
  is_complete: boolean;
  steps_completed: number;
  steps_total: number;
  qa_phase: string | null;
  qa_decision: string | null;
  is_activated: boolean;
  oes_activation_date: string | null;
  oes_imported_at: string | null;
  has_maintenance_ticket: boolean;
  maintenance_ticket_uid: string | null;
  submission_count: number;
  is_resubmission: boolean;
  previous_photo_count: number | null;
  auto_qa_processed: boolean;
  auto_qa_processed_at: string | null;
}

export interface ProjectStats {
  project: string;
  total: number;
  installed: number;
  activated: number;
  reviewed: number;
  notReviewed: number;
}

export interface Summary {
  totalDrops: number;
  installed: number;
  activated: number;
  notReviewed: number;
  reviewed: number;
  totalFeedback: number;
  feedback_sent: number;
  vlm_pending: number;
  vlm_processing: number;
  vlm_categorized: number;
  vlm_failed: number;
}

/** Shared filter shape used across all query and stats services */
export interface DropsFilters {
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  status?: string;
  qaStatus?: string;
  serialStatus?: string;
  resubmissionsOnly?: boolean;
  reviewSource?: string;
  search?: string;
}

export interface Pagination {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedDropsResult {
  drops: UnifiedDrop[];
  pagination: Pagination;
}

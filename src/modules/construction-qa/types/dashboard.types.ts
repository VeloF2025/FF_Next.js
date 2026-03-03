/**
 * Field Ops Hierarchical Dashboard — Type Definitions
 *
 * Types for the Project → Zone → PON drill-down dashboard.
 * API-aligned: each interface matches a specific endpoint response shape.
 */

import type { Discipline, WorkflowStatus } from './construction.types';

// =============================================================================
// Project Dashboard (project-dashboard.ts)
// =============================================================================

/** Per-discipline QA status counts */
export interface DisciplineStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  rework_needed: number;
}

/** One row in the project dashboard grid */
export interface ProjectDashboardRow {
  project_id: string;
  project_name: string;
  total_features: number;
  photo_count: number;
  zone_count: number;
  pon_count: number;
  otdr_count: number;
  civil: DisciplineStats;
  optical: DisciplineStats;
  splicing: DisciplineStats;
}

// =============================================================================
// Zone Hierarchy (zone-hierarchy.ts)
// =============================================================================

/** QA summary for a single PON within a zone */
export interface PonQaSummary {
  pon_no: number;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  rework_needed: number;
  photo_count: number;
  /** Current pipeline stage from pon_stage_tracking */
  overall_stage: string | null;
  /** Per-discipline breakdown */
  civil_count: number;
  optical_count: number;
  splicing_count: number;
}

/** A zone node containing its PON children */
export interface ZoneNode {
  zone_no: number;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  rework_needed: number;
  pons: PonQaSummary[];
}

// =============================================================================
// PON Features (pon-features.ts)
// =============================================================================

/** Single feature row scoped to a project+zone+pon */
export interface PonFeatureRow {
  id: string;
  feature_id: string;
  feature_type: string;
  discipline: Discipline;
  zone_no: number | null;
  pon_no: number | null;
  photo_count: number;
  vlm_confidence: number | null;
  vlm_status: string;
  workflow_status: WorkflowStatus;
  qa_decision: string | null;
  priority: string;
  assigned_to: string | null;
  updated_at: string;
}

// =============================================================================
// Global Search (search.ts)
// =============================================================================

/** A search result with navigation context */
export interface SearchResult {
  id: string;
  feature_id: string;
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  discipline: Discipline;
  workflow_status: WorkflowStatus;
}

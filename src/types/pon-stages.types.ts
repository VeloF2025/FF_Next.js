/**
 * PON Stage Tracking Types
 *
 * Types for the PON build pipeline tracker:
 * Permissions → Poles → CWC → Optical → ATP → Activation
 *
 * Also includes Pre-requisite template types.
 */

// ============================================================================
// PON STAGE TRACKING
// ============================================================================

/** Data for a single build stage within a PON */
export interface PonStageData {
  total: number;
  complete: number;
  pct: number;
  first_date: string | null;
  last_date: string | null;
}

/** The 7 build stages in order */
export type BuildStage = 'permissions' | 'poles' | 'cwc' | 'optical' | 'atp' | 'activation' | 'maintenance';

/** All possible overall_stage values */
export type OverallStage = BuildStage | 'not_started' | 'complete';

/** Build stage display metadata */
export const BUILD_STAGE_META: Record<BuildStage, { label: string; order: number; color: string }> = {
  permissions: { label: 'Permissions', order: 1, color: '#8B5CF6' },
  poles:       { label: 'Poles Planted', order: 2, color: '#3B82F6' },
  cwc:        { label: 'CWC', order: 3, color: '#F59E0B' },
  optical:    { label: 'Optical', order: 4, color: '#10B981' },
  atp:        { label: 'ATP', order: 5, color: '#6366F1' },
  activation:  { label: 'Activation', order: 6, color: '#EF4444' },
  maintenance: { label: 'Maintenance', order: 7, color: '#F97316' },
};

/** Ordered list of build stages */
export const BUILD_STAGES: BuildStage[] = [
  'permissions', 'poles', 'cwc', 'optical', 'atp', 'activation', 'maintenance',
];

/** Single PON row with all 6 stage columns */
export interface PonStageRow {
  zone_no: number;
  pon_no: number;
  permissions: PonStageData;
  poles: PonStageData;
  cwc: PonStageData;
  optical: PonStageData;
  atp: PonStageData;
  activation: PonStageData;
  maintenance: PonStageData;
  cwc_target_date: string | null;
  optical_target_date: string | null;
  activation_target_date: string | null;
  maintenance_target_date: string | null;
  blockage: string | null;
  overall_stage: OverallStage;
  last_synced_at: string;
}

/** Zone-level node with aggregated stage data */
export interface ZoneStageNode {
  zone_no: number;
  zone_name: string;
  pons: PonStageRow[];
  stages: Record<BuildStage, PonStageData>;
}

/** Full PON stages API response */
export interface PonStagesResponse {
  project_id: string;
  project_name: string;
  summary: {
    total_pons: number;
    stages: Record<BuildStage, PonStageData>;
    last_synced: string | null;
  };
  hierarchy: ZoneStageNode[];
  flat: PonStageRow[];
}

// ============================================================================
// 1MAP SYNC TYPES
// ============================================================================

/** Result of a stage sync operation */
export interface StageSyncResult {
  site: string;
  project_id: string;
  records_processed: number;
  pons_synced: number;
  stages_updated: Record<BuildStage, number>;
  errors: string[];
  duration_ms: number;
}

/** 1Map status → build stage mapping entry */
export interface StatusStageMapping {
  pattern: RegExp;
  stage: BuildStage;
  counts_as_complete: boolean;
}

// ============================================================================
// PRE-REQUISITE TYPES
// ============================================================================

/** Pre-req phase identifiers */
export type PrereqPhase =
  | 'site_assignments'
  | 'prerequisites'
  | 'site_establishment'
  | 'contractor_engagements'
  | 'key_milestones';

/** Pre-req phase display labels */
export const PREREQ_PHASE_LABELS: Record<PrereqPhase, string> = {
  site_assignments: 'Site Assignments',
  prerequisites: 'Prerequisites',
  site_establishment: 'Site Establishment',
  contractor_engagements: 'Contractor Engagements',
  key_milestones: 'Key Milestones',
};

/** Single pre-req item */
export interface PrereqItem {
  id: string;
  requirement_type: string;
  requirement_name: string;
  description: string | null;
  stage: string;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  responsible_party: string | null;
  document_url: string | null;
  notes: string | null;
  template_id: string | null;
  /** 'auto' = detected from data, 'manual' = user override, null = not auto-detectable */
  auto_status: 'auto' | 'manual' | null;
}

/** Pre-req items grouped by phase */
export interface PrereqPhaseGroup {
  phase: PrereqPhase;
  phase_label: string;
  items: PrereqItem[];
  total: number;
  completed: number;
  pct: number;
}

/** Pre-reqs API response */
export interface PrereqsResponse {
  project_id: string;
  project_name: string;
  phases: PrereqPhaseGroup[];
  overall: {
    total: number;
    completed: number;
    pct: number;
  };
}

/** Template item for seeding new projects */
export interface PrereqTemplateItem {
  id: string;
  template_name: string;
  phase: PrereqPhase;
  sort_order: number;
  requirement_type: string;
  description: string;
  responsible_party: string | null;
  typical_duration_days: number | null;
}

/** Apply template API response */
export interface ApplyTemplateResponse {
  project_id: string;
  template_name: string;
  items_created: number;
}

// ============================================================================
// PON PROGRESS TRACKING
// ============================================================================

/** Progress category for the working page */
export type ProgressCategory = 'cwc' | 'optical' | 'activation' | 'maintenance';

/** Delay reason options */
export type DelayReason = 'rain' | 'smme_issues' | 'stock_issues' | 'site_stopped' | 'access_issues' | 'power_issues' | 'permit_delay' | 'equipment_failure' | 'other';

export const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  rain: 'Rain',
  smme_issues: 'SMME Issues',
  stock_issues: 'Stock Issues',
  site_stopped: 'Site Stopped',
  access_issues: 'Access Issues',
  power_issues: 'Power Issues',
  permit_delay: 'Permit Delay',
  equipment_failure: 'Equipment Failure',
  other: 'Other',
};

/** Daily activity log entry */
export interface PonDailyLogEntry {
  id: string;
  pon_stage_id: string;
  log_date: string;
  category: ProgressCategory;
  activity: string;
  delay_reason: DelayReason | null;
  logged_by: string | null;
  created_at: string;
}

/** Monthly target per project per category */
export interface ProjectMonthlyTarget {
  id: string;
  project_id: string;
  month: string;
  category: ProgressCategory;
  target_pons: number;
  target_hps: number;
}

/** Progress status for a category */
export type ProgressStatus = 'complete' | 'on_track' | 'at_risk' | 'overdue' | 'no_target';

/** PON progress row (extends stage data with targets + daily log) */
export interface PonProgressRow {
  pon_stage_id: string;
  zone_no: number;
  pon_no: number;
  cwc: PonStageData & { target_date: string | null; status: ProgressStatus };
  optical: PonStageData & { target_date: string | null; status: ProgressStatus };
  activation: PonStageData & { target_date: string | null; status: ProgressStatus };
  maintenance: PonStageData & { target_date: string | null; status: ProgressStatus };
  blockage: string | null;
  recent_logs: PonDailyLogEntry[];
}

/** Zone progress node */
export interface ZoneProgressNode {
  zone_no: number;
  zone_name: string;
  pons: PonProgressRow[];
}

/** Full progress API response */
export interface PonProgressResponse {
  project_id: string;
  project_name: string;
  summary: Record<ProgressCategory, { target: number; actual: number; pct: number }>;
  zones: ZoneProgressNode[];
}

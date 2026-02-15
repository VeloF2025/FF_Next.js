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

/** The 6 build stages in order */
export type BuildStage = 'permissions' | 'poles' | 'cwc' | 'optical' | 'atp' | 'activation';

/** All possible overall_stage values */
export type OverallStage = BuildStage | 'not_started' | 'complete';

/** Build stage display metadata */
export const BUILD_STAGE_META: Record<BuildStage, { label: string; order: number; color: string }> = {
  permissions: { label: 'Permissions', order: 1, color: '#8B5CF6' },
  poles:       { label: 'Poles Planted', order: 2, color: '#3B82F6' },
  cwc:        { label: 'CWC', order: 3, color: '#F59E0B' },
  optical:    { label: 'Optical', order: 4, color: '#10B981' },
  atp:        { label: 'ATP', order: 5, color: '#6366F1' },
  activation: { label: 'Activation', order: 6, color: '#EF4444' },
};

/** Ordered list of build stages */
export const BUILD_STAGES: BuildStage[] = [
  'permissions', 'poles', 'cwc', 'optical', 'atp', 'activation',
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

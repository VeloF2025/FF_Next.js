// Aggregated row supplied by GET /api/works-qa/project-dashboard.
// One row per FibreFlow project that has at least one entry in the
// pole_universe (qfield_photo_validations ∪ pole_qa_photos).

export interface DisciplineStats {
  /** Pole slot capacity for the discipline (7 civil, 8 dome, 6 main_joint). */
  capacity: number;
  /** Poles where this discipline is flipped approved (civil_approved / dome_approved / joint_approved). */
  approved: number;
  /** Poles with at least one slot in this discipline filled but not yet approved. */
  in_progress: number;
  /** Poles with no slots filled in this discipline. */
  empty: number;
  /** Sum of slots in this discipline whose VLM result is valid=false and not overridden. */
  vlm_failed: number;
}

export interface PhotoCompletenessBand {
  /** All fixed slots filled (excludes tray + unassigned). */
  complete_full: number;
  /** 14 slots filled up to one below full. */
  partial_high: number;
  /** 7-13 slots filled. */
  partial_mid: number;
  /** 1-6 slots filled. */
  partial_low: number;
  /** 0 slots filled. */
  no_photos: number;
  /**
   * Slot key with the highest number of empty poles, or null when every slot
   * is at least partially filled. Used for "Most missing: civil_01 (800)".
   */
  most_missing_slot: string | null;
  most_missing_count: number;
}

export interface WorksQADashboardRow {
  project_id: string;
  project_name: string;
  project_code: string | null;

  /** Total poles in the universe (qfield_photo_validations ∪ pole_qa_photos). */
  total_poles: number;
  /** Poles with ALL THREE disciplines approved (the strict completion gate). */
  fully_approved: number;
  /** fully_approved / total_poles as 0-100 integer. */
  qa_progress_pct: number;
  /** Poles where at least one discipline is approved but not all three. */
  in_progress: number;
  /** Poles with zero slots filled. */
  empty: number;

  civil:      DisciplineStats;
  dome:       DisciplineStats;
  main_joint: DisciplineStats;

  photo_completeness: PhotoCompletenessBand;

  /** Sum of unassigned_photo_keys array lengths across the project. */
  unassigned_total: number;
  /** Distinct poles with non-empty unassigned_photo_keys. */
  unassigned_poles: number;
  /** Poles with overridden_at IS NOT NULL (force-approve audit count). */
  override_count: number;

  /** Open Works-QA snags for this project. */
  open_snags: number;

  zone_count: number;
  pon_count: number;
  /** Total photos across all 22 slot columns + tray + unassigned. */
  photo_count: number;
  /** MAX(updated_at) across pole_qa_photos for this project, or null. */
  last_synced_at: string | null;
}

export interface WorksQADashboardResponse {
  projects: WorksQADashboardRow[];
}

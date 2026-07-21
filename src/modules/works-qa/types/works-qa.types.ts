export interface VlmSlotResult {
  valid: boolean;
  confidence: number;
  feedback: string;
  overridden_by?: string;
  override_reason?: string;
  // True once the VLM has actually scored this slot. A pending (never-scored)
  // slot is written as `{ scored: false }` with no `valid` field, so the UI can
  // show "Awaiting AI" instead of a red failure. Scored-detection elsewhere keys
  // on the presence of a boolean `valid`, not on this flag.
  scored?: boolean;
  // Set when a single photo is reused to satisfy a second step (e.g. a depth
  // shot that also shows the end-plates). Distinct from a normal override so it
  // can be excluded from VLM training — see pages/api/works-qa/link-photo.ts.
  dual_step?: boolean;
  source_slot?: string;
}

export interface PoleQaPhoto {
  id: string;
  project_id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;

  // Civil
  civil_step_01_key: string | null;
  civil_step_02_key: string | null;
  civil_step_03_key: string | null;
  civil_step_04_key: string | null;
  civil_step_05_key: string | null;
  civil_step_06_key: string | null;
  civil_step_07_key: string | null;
  civil_step_08_key: string | null;

  // Optical Dome
  optical_dome_01_key: string | null;
  optical_dome_02_key: string | null;
  optical_dome_03_key: string | null;
  optical_dome_04_key: string | null;
  optical_dome_05_key: string | null;
  optical_dome_06_key: string | null;
  optical_dome_07_key: string | null;
  optical_dome_08_key: string | null;

  // Main Joint (renamed from Optical Joint)
  main_joint_11_key: string | null;
  main_joint_12_key: string | null;
  main_joint_13_key: string | null;
  main_joint_14_key: string | null;
  main_joint_15_key: string | null;
  main_joint_16_key: string | null;

  main_joint_tray_keys: string[];
  unassigned_photo_keys: string[];
  // Soft-delete bin (migration 442). Photos removed from the Unassigned bucket
  // land here instead of being dropped, so a mis-delete is recoverable. Restore
  // moves a key back to unassigned_photo_keys.
  deleted_photo_keys: string[];
  unassigned_suggestions?: Record<string, { suggested_slot: string; confidence: number; generated_at?: string }>;
  vlm_results: Record<string, VlmSlotResult>;
  // Per-slot Approve / Snag decisions (migration 247). Keyed by SLOT_META.key.
  // Optional because pre-migration rows lack the column and the API may return
  // null/undefined; callers MUST use optional chaining.
  slot_approvals?: Record<string, SlotApproval>;

  civil_approved: boolean;
  dome_approved: boolean;
  joint_approved: boolean;          // DB column kept as-is, represents 'main_joint' discipline
  approved_by: string | null;
  approved_at: string | null;
  // Force-approve audit trail (migration 354). Set when an approver bypasses
  // disciplineGatesPass with a reason. Last-write-wins at row level.
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  created_at: string;
  updated_at: string;

  comments?: PoleQaComment[];
}

export interface SlotApproval {
  decision: 'approved' | 'snagged';
  by: string;
  at: string;
  snag_id?: string;
}

export interface PoleQaComment {
  id: string;
  discipline: 'civil' | 'dome' | 'main_joint';
  comment: string;
  created_by: string;
  created_at: string;
}

// Per-slot review state shown as a dot on the PON overview (Works QA).
//  - 'approved' → a person approved this photo (slot_approvals.decision)   → strong green
//  - 'pass'     → has a photo, VLM-valid (or overridden), not yet approved → faint green
//  - 'fail'     → snagged by a person OR an un-overridden VLM failure      → red
//  - 'empty'    → no photo in this slot                                    → grey
export type SlotState = 'empty' | 'approved' | 'pass' | 'fail';

export interface PoleSummary {
  id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  civil_filled: number;     // 0-8
  dome_filled: number;      // 0-8
  joint_filled: number;     // 0-6
  tray_count: number;
  vlm_failures: number;
  // Per-slot states for the overview dots (lengths: 8 civil, 8 dome, 6 joint).
  civil_slots: SlotState[];
  dome_slots: SlotState[];
  joint_slots: SlotState[];
  // Total photos uploaded on the pole, including unassigned (Johan's overview ask).
  total_photos: number;
  unassigned_count: number;
  // 'planted' = field-confirmed planted (QField civil-audit Status) but no QA
  // photos yet — a row that exists in `poles` but not `pole_qa_photos`. All other
  // states require a pole_qa_photos row (has_photos = true).
  status: 'empty' | 'in_progress' | 'ready' | 'snagged' | 'approved' | 'planted';
  approved_at: string | null;
  outstanding_snag_count: number;
  has_open_verification_snag: boolean;
  has_verified_planted: boolean;
  // True when this row is backed by a pole_qa_photos record (QA-able / clickable).
  // False for planted-only rows synthesised from poles.field_status.
  has_photos: boolean;
  // QField civil-audit Status (poles.field_status). Drives the planted-row badge
  // and is null for photographed rows that pre-date / lack a field_status sync.
  field_status: string | null;
}

export interface WorksQAProjectStats {
  project_id: string;
  project_name: string;
  project_code: string | null;
  total: number;
  approved: number;
  ready: number;
  in_progress: number;
  empty: number;
  pending_vlm: number;
}

export interface WorksQAZoneSummary {
  zone_no: number | null;
  pon_count: number;
  pole_count: number;
  approved_count: number;
  outstanding_snag_count: number;
  pons: { pon_no: number; pole_count: number; approved_count: number; outstanding_snag_count: number }[];
}

// ─── Recent Submissions feed ─────────────────────────────────────────────
export type RecentDiscipline = 'civil' | 'dome' | 'main_joint';
export type RecentWindow = 'since_last' | '3d' | '7d';

export interface RecentPon {
  ponNo: number;
  readyCount: number;
  partialCount: number;
  latestAt: string | null;
}

export interface RecentZone {
  zoneNo: number | null;
  pons: RecentPon[];
}

export interface RecentSite {
  projectId: string;
  projectName: string;
  zones: RecentZone[];
}

export interface RecentLane {
  readyPoles: number;
  partialPoles: number;
  sites: RecentSite[];
}

export interface RecentSubmissionsResponse {
  window: RecentWindow;
  cutoffAt: string;            // boundary the feed is filtered to
  watermarkAt: string | null;  // user's last-opened cutoff; drives the "NEW" flag
  asOf: string;
  lanes: Record<RecentDiscipline, RecentLane>;
}

export type SlotKey =
  | 'civil_01' | 'civil_02' | 'civil_03' | 'civil_04' | 'civil_05' | 'civil_06' | 'civil_07' | 'civil_08'
  | 'dome_01' | 'dome_02' | 'dome_03' | 'dome_04' | 'dome_05' | 'dome_06' | 'dome_07' | 'dome_08'
  | 'main_joint_11' | 'main_joint_12' | 'main_joint_13' | 'main_joint_14' | 'main_joint_15' | 'main_joint_16'
  | 'tray_photos';

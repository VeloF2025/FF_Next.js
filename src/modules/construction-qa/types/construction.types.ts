/**
 * Construction QA Module — TypeScript Type Definitions
 *
 * Covers the two pre-activation construction disciplines:
 *   • Civil      — pole planting
 *   • Optical    — dome joint installation (Phase A: distribution dome, Phase B: main joint)
 *
 * Database alignment: construction_qa_reviews, construction_qa_photos,
 *   construction_qa_activity, construction_qa_assignments (migrations 200–203, 240).
 *
 * NLNH Confidence: HIGH — types derived directly from PRD sections 6, 7, and 14.
 */

// ============================================================================
// PRIMITIVE UNION TYPES (Enums as const-unions for type safety)
// ============================================================================

/** The construction discipline being quality-assured. */
export type Discipline = 'civil' | 'optical';

/**
 * The physical infrastructure feature under review.
 * Maps 1:1 with database tables: poles, cable_spans, joints.
 */
export type FeatureType = 'pole' | 'cable_span' | 'joint';

/**
 * Workflow lifecycle for a construction QA review record.
 * Mirrors dr_photo_unified_reviews workflow in the Activate module.
 */
export type WorkflowStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'rework_needed'
  | 'escalated'
  | 'unidentified';

/** Processing state of the VLM validation pipeline for a review. */
export type VlmStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Photo storage origin — used for proxy routing and audit trail. */
export type PhotoSource = 'qfield' | 'sharepoint' | 'whatsapp' | 'upload';

/**
 * Formal QA decision on a feature, made in Phase 4 of the wizard.
 * REWORK_NEEDED sends the feature back to the field without failing it permanently.
 */
export type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED';

/** SharePoint sync status for civil QA approved photos. */
export type SpSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/** Review queue priority for triage and assignment ordering. */
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Manual override on a single photo (distinct from whole-feature QaDecision).
 * NULL means no manual review yet.
 */
export type PhotoManualStatus = 'approved' | 'rejected' | 'pending' | null;

/**
 * Activity event types logged to construction_qa_activity.
 * Provides a full audit trail of every state change.
 */
export type ActivityEventType =
  | 'photo_ingested'
  | 'vlm_started'
  | 'vlm_completed'
  | 'vlm_failed'
  | 'review_opened'
  | 'step_checked'
  | 'step_unchecked'
  | 'decision_made'
  | 'feedback_sent'
  | 'rework_requested'
  | 'resubmission_received'
  | 'assigned'
  | 'escalated'
  | 'comment_added';

// ============================================================================
// CHECKLIST STEP DEFINITIONS
// ============================================================================

/** A single step in a discipline-specific photo checklist. */
export interface ChecklistStep {
  /** Step number (1-based, matches civil_step_0N / optical_step_0N columns). */
  step: number;
  /** Human-readable label shown in the wizard UI. */
  label: string;
  /**
   * Whether a photo for this step is always required.
   * When false the step is conditional (e.g., guy wires only if pole >9m).
   */
  required: boolean;
  /** Short description of what the VLM checks for this step. */
  vlmCheck: string;
  /** Optional field notes displayed as a tooltip in the wizard. */
  notes?: string;
}

/**
 * Eight-step checklist for civil (pole planting) discipline.
 * Aligned with Velocity Fibre Pole Install Capture Checklist.
 * Phase A: Pre-Install (1-5), Phase B: Installation (6-7), Phase C: Assets (8).
 */
export const CIVIL_CHECKLIST: readonly ChecklistStep[] = [
  {
    step: 1,
    label: 'Before Photo',
    required: true,
    vlmCheck: 'Undisturbed ground with chalk/spray paint markings (circle, square, or X) showing where the hole will be dug. NO hole visible yet, NO digging has started, NO pole present. The ground surface is intact.',
    notes: 'Phase A Pre-Install — BEFORE any digging. Key distinction from Step 2: no hole exists yet, ground is unbroken.',
  },
  {
    step: 2,
    label: 'During Photo',
    required: true,
    vlmCheck: 'Active excavation in progress: open hole in the ground, workers digging, spade/pick visible, or freshly dug earth piled beside the hole. The ground has been broken open. NO pole installed yet.',
    notes: 'Phase A Pre-Install — DURING digging. Key distinction from Step 1: a hole or disturbed earth is clearly visible.',
  },
  {
    step: 3,
    label: 'Depth Photo',
    required: true,
    vlmCheck: 'Measuring tape or ruler in hole showing depth measurement',
    notes: 'Phase A Pre-Install — tape measure is key visual indicator',
  },
  {
    step: 4,
    label: 'End Plates',
    required: true,
    vlmCheck: 'Close-up of metal end-plates, HDPE strapping, cap plates, or metal brackets attached to the pole. Shows hardware/fittings/bolts on the pole itself — NOT ground.',
    notes: 'Phase A Pre-Install — metal hardware ON the pole. 200 errors: VLM wrongly calls these "Unrelated". If you see metal on a pole → Step 4.',
  },
  {
    step: 5,
    label: 'Compaction / Backfill',
    required: true,
    vlmCheck: 'Pole is STANDING, hole is FILLED and packed with sand+cement around the pole base. Compacted surface, NOT a loose heap. Key: pole installed + filled ground.',
    notes: 'Phase A Pre-Install — 207 errors: confused with During (Step 2). During=open hole, Compaction=filled hole with pole standing.',
  },
  {
    step: 6,
    label: 'Level Check',
    required: true,
    vlmCheck: 'Spirit level (yellow/green bubble level tool) held against the side of an upright pole.',
    notes: 'Phase B Installation — the bubble level tool is the key visual indicator.',
  },
  {
    step: 7,
    label: 'After Photo',
    required: true,
    vlmCheck: 'Full pole standing upright, wide shot from distance',
    notes: 'Phase B Installation — may include ground-level + standing-back view',
  },
] as const;

/**
 * Optical checklist — Distribution Dome (Phase A, 8 steps).
 * Aligned with Velocity Fibre Optical Checklist Phase A.
 */
export const OPTICAL_DOME_CHECKLIST: readonly ChecklistStep[] = [
  {
    step: 1,
    label: 'Dome on Pole',
    required: true,
    vlmCheck: 'Wide shot of splice dome installed on pole',
    notes: 'Phase A Distribution Dome — full dome visible in position',
  },
  {
    step: 2,
    label: 'Dome Label',
    required: true,
    vlmCheck: 'Dome label with Pole ID / Fibre ID clearly readable',
    notes: 'Phase A Distribution Dome — close-up of label text',
  },
  {
    step: 3,
    label: 'Open Dome',
    required: true,
    vlmCheck: 'Fibre routing and tray layout visible inside open dome',
    notes: 'Phase A Distribution Dome — interior of dome visible',
  },
  {
    step: 4,
    label: 'Splice Protectors',
    required: true,
    vlmCheck: 'Splice protectors fitted correctly over fibre splices',
    notes: 'Phase A Distribution Dome — close-up inside dome',
  },
  {
    step: 5,
    label: 'Slack Management',
    required: true,
    vlmCheck: 'Neat fibre loops and cable organization within dome',
    notes: 'Phase A Distribution Dome — slack cables managed',
  },
  {
    step: 6,
    label: 'Strength Members',
    required: true,
    vlmCheck: 'Strength members (aramid/steel) secured inside dome',
    notes: 'Phase A Distribution Dome — properly fastened',
  },
  {
    step: 7,
    label: 'Seals & Dust Caps',
    required: true,
    vlmCheck: 'Dome seals tightened, dust caps on unused ports',
    notes: 'Phase A Distribution Dome — weatherproofing visible',
  },
  {
    step: 8,
    label: 'Pole ID',
    required: true,
    vlmCheck: 'Pole ID label/tag attached to pole near dome',
    notes: 'Phase A Distribution Dome — number/barcode readable',
  },
] as const;

/**
 * Optical checklist — Main Joint (Phase B, 6 steps, numbered 11-16).
 * Aligned with Velocity Fibre Optical Checklist Phase B.
 */
export const OPTICAL_JOINT_CHECKLIST: readonly ChecklistStep[] = [
  {
    step: 11,
    label: 'Cable Entries',
    required: true,
    vlmCheck: 'Labelled cable entries into main joint closure',
    notes: 'Phase B Main Joint — cable markings and entry points',
  },
  {
    step: 12,
    label: 'Strength Members',
    required: true,
    vlmCheck: 'Strength members properly secured within closure',
    notes: 'Phase B Main Joint — aramid yarn or steel wire',
  },
  {
    step: 13,
    label: 'Tube Routing',
    required: true,
    vlmCheck: 'Fibre tubes routed neatly from entry to splice tray',
    notes: 'Phase B Main Joint — organized tube layout',
  },
  {
    step: 14,
    label: 'Tray Entries',
    required: true,
    vlmCheck: 'Fibre entering splice trays in organized manner',
    notes: 'Phase B Main Joint — neat tray connections',
  },
  {
    step: 15,
    label: 'Coiling & Protectors',
    required: true,
    vlmCheck: 'Fibre coiling loops and visible splice protectors',
    notes: 'Phase B Main Joint — heat shrinks or mechanical holders',
  },
  {
    step: 16,
    label: 'Readable Labels',
    required: true,
    vlmCheck: 'Clear readable labels on cables, tubes, or closure',
    notes: 'Phase B Main Joint — legible identification',
  },
] as const;

/**
 * Combined optical checklist: Phase A (dome, 8 steps) + Phase B (main joint, 6 steps) = 14 steps.
 * This is the default checklist used for the optical discipline.
 */
export const OPTICAL_CHECKLIST: readonly ChecklistStep[] = [
  ...OPTICAL_DOME_CHECKLIST,
  ...OPTICAL_JOINT_CHECKLIST,
] as const;

/** Returns the correct checklist for a given discipline and optional sub-type. */
export function getChecklist(discipline: Discipline, subType?: 'dome' | 'main_joint'): readonly ChecklistStep[] {
  if (discipline === 'civil') return CIVIL_CHECKLIST;
  // Optical: sub-type allows Phase A or Phase B independently; default returns combined
  if (subType === 'dome') return OPTICAL_DOME_CHECKLIST;
  if (subType === 'main_joint') return OPTICAL_JOINT_CHECKLIST;
  return OPTICAL_CHECKLIST;
}

/** Maximum step number per discipline (dome default for optical). */
export const CHECKLIST_STEP_COUNT: Record<Discipline, number> = {
  civil: 8,
  optical: 8,  // dome=8, main_joint uses 11-16; combined = 14 steps
};

// ============================================================================
// REASON CODES (per discipline)
// ============================================================================

/** Rejection reason codes for the civil (pole planting) discipline. */
export type CivilReasonCode =
  | 'CIVIL_BEFORE_PHOTO_MISSING'
  | 'CIVIL_DEPTH_NOT_DOCUMENTED'
  | 'CIVIL_END_PLATES_NOT_VISIBLE'
  | 'CIVIL_COMPACTION_IMPROPER'
  | 'CIVIL_LEVEL_CHECK_MISSING'
  | 'CIVIL_AFTER_PHOTO_MISSING'
  | 'CIVIL_SIGNATURE_MISSING'
  | 'CIVIL_PHOTO_BLURRY'
  | 'CIVIL_WRONG_POLE'
  | 'CIVIL_INCOMPLETE_CHECKLIST';

/** Rejection reason codes for the optical (dome joint installation) discipline. */
export type OpticalReasonCode =
  | 'OPTICAL_DOME_NOT_SEALED'
  | 'OPTICAL_NOT_ON_BRACKET'
  | 'OPTICAL_EMERGENCY_LOOP_MISSING'
  | 'OPTICAL_BACKHAUL_NOT_SEPARATED'
  | 'OPTICAL_TRAY_DISORGANIZED'
  | 'OPTICAL_HEAT_SHRINKS_MISSING'
  | 'OPTICAL_LABEL_UNREADABLE'
  | 'OPTICAL_PHOTO_BLURRY'
  | 'OPTICAL_INCOMPLETE_CHECKLIST';

/** Union of all discipline-specific reason codes. */
export type QaReasonCode = CivilReasonCode | OpticalReasonCode;

/** Human-readable plain-English descriptions keyed by reason code. */
export const REASON_CODE_LABELS: Record<QaReasonCode, string> = {
  CIVIL_BEFORE_PHOTO_MISSING: 'Before photo (ground markout) not provided',
  CIVIL_DEPTH_NOT_DOCUMENTED: 'Depth measurement photo missing or unreadable',
  CIVIL_END_PLATES_NOT_VISIBLE: 'End plates not clearly visible',
  CIVIL_COMPACTION_IMPROPER: 'Compaction/backfill not mixed properly (sand+cement required)',
  CIVIL_LEVEL_CHECK_MISSING: 'Spirit level check photo not provided',
  CIVIL_AFTER_PHOTO_MISSING: 'After photo (full pole view) not provided',
  CIVIL_SIGNATURE_MISSING: 'Contractor signature not present',
  CIVIL_PHOTO_BLURRY: 'Photo is blurry or out of focus',
  CIVIL_WRONG_POLE: 'Photo does not match the expected pole number',
  CIVIL_INCOMPLETE_CHECKLIST: 'One or more required checklist steps have no photo',

  OPTICAL_DOME_NOT_SEALED: 'Dome enclosure is not fully sealed',
  OPTICAL_NOT_ON_BRACKET: 'Dome is not mounted on a slack bracket',
  OPTICAL_EMERGENCY_LOOP_MISSING: 'Emergency fiber loop is missing or too short',
  OPTICAL_BACKHAUL_NOT_SEPARATED: 'Backhaul fiber is not separated from distribution',
  OPTICAL_TRAY_DISORGANIZED: 'Splice trays are disorganized',
  OPTICAL_HEAT_SHRINKS_MISSING: 'Heat shrinks are missing on one or more splices',
  OPTICAL_LABEL_UNREADABLE: 'Dome label is unreadable or missing',
  OPTICAL_PHOTO_BLURRY: 'Photo is blurry or out of focus',
  OPTICAL_INCOMPLETE_CHECKLIST: 'One or more required checklist steps have no photo',
};

// ============================================================================
// JSONB SUB-TYPES (embedded in database JSONB columns)
// ============================================================================

/**
 * Photo metadata object stored inside construction_qa_reviews.photos_json.
 * Provides a lightweight summary without joining the photos table.
 */
export interface ReviewPhotoSummary {
  /** URL to fetch the photo (may expire — use proxy endpoint). */
  url: string;
  /** Original source of this photo. */
  source: PhotoSource;
  /** Checklist step number this photo is assigned to (null if unassigned). */
  step: number | null;
  /** Original filename from source system. */
  filename: string;
  /** File size in bytes (null if unknown). */
  size: number | null;
  /** ISO timestamp when the photo was captured (EXIF or ingestion time). */
  captured_at: string | null;
}

/**
 * Per-step VLM confidence scores stored in construction_qa_reviews.vlm_step_scores.
 * Keys are step numbers as strings (e.g., "step_01", "step_02").
 */
export type VlmStepScores = Record<string, number>;

/**
 * Snapshot of review state at the time of a rework submission.
 * Stored in construction_qa_reviews.resubmission_snapshots JSONB array.
 */
export interface ResubmissionSnapshot {
  /** ISO timestamp when this snapshot was taken. */
  captured_at: string;
  /** Workflow status at time of snapshot. */
  workflow_status: WorkflowStatus;
  /** Number of photos at time of snapshot. */
  photo_count: number;
  /** Overall VLM confidence at time of snapshot. */
  vlm_confidence: number | null;
  /** QA decision at time of snapshot. */
  qa_decision: QaDecision | null;
  /** Notes recorded at time of snapshot. */
  qa_notes: string | null;
  /** Reason codes recorded at time of snapshot. */
  reason_codes: QaReasonCode[];
}

// ============================================================================
// DATABASE RECORD INTERFACES
// ============================================================================

/**
 * construction_qa_reviews — primary QA record per feature.
 *
 * One row per (project_id, feature_type, feature_id) triplet.
 * Aggregates photo state, VLM results, and workflow lifecycle.
 * Matches the SQL schema in migration 200_construction_qa_reviews.sql + 240_optical_discipline_consolidation.sql.
 */
export interface ConstructionQaReview {
  // ── Primary key ──────────────────────────────────────────────────────────
  id: string; // UUID

  // ── Feature identification ───────────────────────────────────────────────
  project_id: string; // UUID — FK → projects.id
  discipline: Discipline;
  feature_type: FeatureType;
  /** Pole number, span label, or joint label from QField. */
  feature_id: string;
  zone_no: number | null;
  pon_no: number | null;

  // ── Photo state ───────────────────────────────────────────────────────────
  photo_count: number;
  photos_json: ReviewPhotoSummary[];
  photo_sources: PhotoSource[];
  last_photo_at: string | null; // ISO timestamp

  // ── Civil checklist steps (Pole Install Capture Checklist) ────────────────
  civil_step_01_before_photo: boolean;
  civil_step_02_during_photo: boolean;
  civil_step_03_depth_photo: boolean;
  civil_step_04_end_plates: boolean;
  civil_step_05_compaction: boolean;
  civil_step_06_level_check: boolean;
  civil_step_07_after_photo: boolean;
  civil_step_08_signature: boolean;

  // ── Optical checklist steps — Distribution Dome / Phase A (steps 1-8) ────
  optical_step_01_dome_on_pole: boolean;
  optical_step_02_dome_label: boolean;
  optical_step_03_open_dome: boolean;
  optical_step_04_splice_protectors: boolean;
  optical_step_05_slack_management: boolean;
  optical_step_06_strength_members: boolean;
  optical_step_07_seals_dustcaps: boolean;
  optical_step_08_pole_id: boolean;

  // ── Optical checklist steps — Main Joint / Phase B (steps 11-16) ─────────
  optical_step_11_cable_entries: boolean;
  optical_step_12_strength_members: boolean;
  optical_step_13_tube_routing: boolean;
  optical_step_14_tray_entries: boolean;
  optical_step_15_coiling_protectors: boolean;
  optical_step_16_readable_labels: boolean;

  /** Sub-type for optical reviews: 'dome' (Phase A) or 'main_joint' (Phase B). */
  optical_sub_type: 'dome' | 'main_joint' | null;

  // ── VLM processing ────────────────────────────────────────────────────────
  vlm_status: VlmStatus;
  /** Aggregate confidence score 0.00–1.00, null until VLM completes. */
  vlm_confidence: number | null;
  vlm_step_scores: VlmStepScores;
  vlm_issues: string[];
  vlm_feedback: string | null;
  vlm_raw_response: VlmOverallResult | null;
  vlm_processed_at: string | null; // ISO timestamp
  /** Model and prompt version used for reproducibility. */
  vlm_model_version: string | null;
  vlm_retry_count: number;

  // ── VLM-extracted data ────────────────────────────────────────────────────
  extracted_pole_number: string | null;
  extracted_pole_height: string | null;
  extracted_cable_type: string | null;
  extracted_joint_type: string | null;
  extracted_splice_count: number | null;
  extracted_notes: Record<string, unknown>;

  // ── QA workflow ───────────────────────────────────────────────────────────
  workflow_status: WorkflowStatus;
  manual_status: 'approved' | 'rejected' | 'rework_needed' | null;
  qa_decision: QaDecision | null;
  qa_decision_at: string | null; // ISO timestamp
  qa_decision_by: string | null;
  qa_reason_code: QaReasonCode | null;
  qa_notes: string | null;
  rework_count: number;

  // ── Assignment ────────────────────────────────────────────────────────────
  assigned_to: string | null;
  assigned_at: string | null; // ISO timestamp
  assigned_by: string | null;
  due_date: string | null; // ISO timestamp
  priority: Priority;

  // ── Escalation ────────────────────────────────────────────────────────────
  escalation_level: number;
  escalated_at: string | null; // ISO timestamp
  escalation_reason: string | null;

  // ── WhatsApp feedback ─────────────────────────────────────────────────────
  wa_feedback_sent_at: string | null; // ISO timestamp
  wa_feedback_message: string | null;
  wa_group_jid: string | null;
  wa_technician_phone: string | null;

  // ── Submission tracking ───────────────────────────────────────────────────
  submission_count: number;
  first_submitted_at: string | null; // ISO timestamp
  last_submitted_at: string | null; // ISO timestamp
  resubmission_snapshots: ResubmissionSnapshot[];

  // ── Denormalized feature data ─────────────────────────────────────────────
  pole_latitude: number | null;
  pole_longitude: number | null;
  pole_material: string | null;
  pole_height_m: number | null;
  span_from_pole: string | null;
  span_to_pole: string | null;
  span_length_m: number | null;
  span_cable_size: string | null;
  joint_cable_cap: string | null;

  // ── Metadata ──────────────────────────────────────────────────────────────
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * construction_qa_photos — individual photo records.
 *
 * One row per distinct photo ingested from any source.
 * Supports per-photo VLM results and manual review decisions.
 * Matches migration 201_construction_qa_photos.sql exactly.
 */
export interface ConstructionQaPhoto {
  id: string; // UUID

  // ── Linkage ───────────────────────────────────────────────────────────────
  review_id: string; // UUID — FK → construction_qa_reviews.id
  project_id: string; // UUID — FK → projects.id

  // ── Storage reference ─────────────────────────────────────────────────────
  source: PhotoSource;
  /** Source-specific reference: MinIO path, SharePoint item ID, Firebase path, WA message ID. */
  storage_key: string;
  /** Resolved URL — may expire; regenerate via photo-proxy endpoint. */
  storage_url: string | null;
  filename: string | null;
  file_size_bytes: number | null;
  mime_type: string;

  // ── Checklist assignment ──────────────────────────────────────────────────
  /** Step number 1–7 (civil) or 1–8 + 11–16 (optical). Null if uncategorized. */
  checklist_step: number | null;
  step_label: string | null;

  // ── VLM per-photo results ─────────────────────────────────────────────────
  vlm_valid: boolean | null;
  vlm_confidence: number | null;
  vlm_issues: string[];
  vlm_feedback: string | null;
  vlm_raw: VlmStepResult | null;
  vlm_processed_at: string | null; // ISO timestamp

  // ── Manual review ─────────────────────────────────────────────────────────
  manual_status: PhotoManualStatus;
  manual_reviewed_by: string | null;
  manual_reviewed_at: string | null; // ISO timestamp
  manual_notes: string | null;

  // ── Retake tracking ───────────────────────────────────────────────────────
  needs_retake: boolean;
  retake_notified_at: string | null; // ISO timestamp
  retake_completed_at: string | null; // ISO timestamp
  /** UUID of the original rejected photo this one replaces. */
  retake_for_photo_id: string | null;

  // ── Capture metadata ──────────────────────────────────────────────────────
  captured_at: string | null; // ISO timestamp (EXIF)
  gps_lat: number | null;
  gps_lon: number | null;
  /** QField username or technician phone number. */
  captured_by: string | null;

  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * construction_qa_activity — immutable audit log.
 *
 * Every state transition, human action, and automated event is appended here.
 * Records are never updated or deleted.
 * Matches migration 202_construction_qa_activity.sql exactly.
 */
export interface ConstructionQaActivity {
  id: string; // UUID
  review_id: string; // UUID — FK → construction_qa_reviews.id
  photo_id: string | null; // UUID — FK → construction_qa_photos.id (if photo-specific)

  event_type: ActivityEventType;

  /** User ID, 'system', or 'vlm'. */
  actor: string | null;
  actor_name: string | null;
  /** Arbitrary structured data for this event (e.g., old vs new step for reassignment). */
  payload: Record<string, unknown>;
  notes: string | null;

  created_at: string; // ISO timestamp
}

/**
 * construction_qa_assignments — reviewer assignment record.
 *
 * Tracks who is responsible for reviewing a specific feature and by when.
 * Matches migration 203_construction_qa_assignments.sql exactly.
 */
export interface ConstructionQaAssignment {
  id: string; // UUID
  review_id: string; // UUID — FK → construction_qa_reviews.id

  assigned_to: string;
  assigned_by: string;
  assigned_at: string; // ISO timestamp
  due_date: string | null; // ISO timestamp
  priority: Priority;
  notes: string | null;
  completed_at: string | null; // ISO timestamp
}

// ============================================================================
// DATABASE VIEW TYPE
// ============================================================================

/**
 * v_construction_qa_reviews — enriched view of the review record.
 *
 * Joins project name, live feature data from poles / cable_spans / joints,
 * and computed counters for approved photos and pending retakes.
 */
export interface ConstructionQaReviewEnriched extends ConstructionQaReview {
  // ── Joined project ────────────────────────────────────────────────────────
  project_name: string;
  client_id: string | null;

  // ── Live pole context ─────────────────────────────────────────────────────
  pole_type_live: string | null;
  pole_height_live: number | null;
  pole_material_live: string | null;
  pole_status_live: string | null;
  pole_lat_live: number | null;
  pole_lon_live: number | null;

  // ── Live span context ─────────────────────────────────────────────────────
  span_type_live: string | null;
  cable_size_live: string | null;
  span_length_live: number | null;

  // ── Live joint context ────────────────────────────────────────────────────
  joint_type_live: string | null;
  joint_cable_cap_live: string | null;

  // ── Computed counters ─────────────────────────────────────────────────────
  approved_photo_count: number;
  pending_retake_count: number;
}

// ============================================================================
// VLM RESPONSE TYPES
// ============================================================================

/**
 * Structured data extracted by VLM from a specific photo.
 * Shape varies by discipline and step — typed as a record for flexibility.
 */
export type VlmExtractedData = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

/**
 * VLM result for a single photo validation call.
 * Matches the JSON schema returned by Qwen3-VL on Velocity:8100.
 */
export interface VlmStepResult {
  /** Whether the photo meets the quality requirements for this step. */
  valid: boolean;
  /** Confidence score 0.0–1.0. */
  confidence: number;
  /** Step number validated (1-based). */
  step: number;
  /** Human-readable step name. */
  step_label: string;
  /** List of specific quality issues found (empty array if none). */
  issues: string[];
  /** One-sentence actionable feedback for the technician. */
  feedback: string;
  /** Discipline-specific extracted data (pole number, cable type, etc.). */
  extracted_data: VlmExtractedData;
}

/**
 * Aggregate VLM result for all photos in a review.
 * Stored in construction_qa_reviews.vlm_raw_response.
 */
export interface VlmOverallResult {
  /** Aggregate pass/fail across all steps. */
  overall_valid: boolean;
  /** Weighted average confidence across all photos validated. */
  overall_confidence: number;
  /** Per-step results keyed by step number string (e.g., "1", "2"). */
  steps: Record<string, VlmStepResult>;
  /** Cross-step issues that could not be attributed to a single photo. */
  cross_step_issues: string[];
  /** ISO timestamp of this VLM run. */
  processed_at: string;
  /** Model version identifier for reproducibility. */
  model_version: string;
}

// ============================================================================
// API REQUEST / RESPONSE TYPES
// ============================================================================

// ── Shared pagination ─────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ── Features list ─────────────────────────────────────────────────────────────

/**
 * Query parameters for GET /api/construction-qa/features.
 * projectId is always required; all others are optional filters.
 */
export interface FeaturesListRequest {
  projectId: string;
  discipline?: Discipline;
  workflowStatus?: WorkflowStatus;
  zoneNo?: number;
  ponNo?: number;
  priority?: Priority;
  assignedTo?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: keyof ConstructionQaReview;
  sortDir?: 'asc' | 'desc';
}

/** Summary counts returned alongside the paginated feature list. */
export interface FeaturesListSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  rework_needed: number;
  escalated: number;
  unidentified: number;
}

/** Response shape for GET /api/construction-qa/features. */
export interface FeaturesListResponse {
  success: boolean;
  data: ConstructionQaReview[];
  pagination: PaginationMeta;
  summary: FeaturesListSummary;
}

// ── VLM validation ────────────────────────────────────────────────────────────

/** Body for POST /api/construction-qa/vlm-validate. */
export interface VlmValidateRequest {
  /** Review whose photos should be validated. */
  reviewId: string;
  /** If provided, validate only this single photo. */
  photoId?: string;
  discipline: Discipline;
  /** Re-run VLM even if photos already have results. */
  forceRerun?: boolean;
}

/** Response for POST /api/construction-qa/vlm-validate. */
export interface VlmValidateResponse {
  success: boolean;
  reviewId: string;
  photosProcessed: number;
  overallConfidence: number | null;
  vlmStatus: VlmStatus;
  stepResults: VlmStepResult[];
  error?: string;
}

// ── Review action ─────────────────────────────────────────────────────────────

/**
 * Body for POST /api/construction-qa/review.
 * Saves partial phase 2/3 state without finalizing the decision.
 */
export interface ReviewActionRequest {
  reviewId: string;
  /** Step flags to update (use discipline-appropriate keys). */
  stepUpdates?: Partial<
    Pick<
      ConstructionQaReview,
      // Civil — Pole Install (8 steps)
      | 'civil_step_01_before_photo'
      | 'civil_step_02_during_photo'
      | 'civil_step_03_depth_photo'
      | 'civil_step_04_end_plates'
      | 'civil_step_05_compaction'
      | 'civil_step_06_level_check'
      | 'civil_step_07_after_photo'
      | 'civil_step_08_signature'
      // Optical — Dome / Phase A (steps 1-8)
      | 'optical_step_01_dome_on_pole'
      | 'optical_step_02_dome_label'
      | 'optical_step_03_open_dome'
      | 'optical_step_04_splice_protectors'
      | 'optical_step_05_slack_management'
      | 'optical_step_06_strength_members'
      | 'optical_step_07_seals_dustcaps'
      | 'optical_step_08_pole_id'
      // Optical — Main Joint / Phase B (steps 11-16)
      | 'optical_step_11_cable_entries'
      | 'optical_step_12_strength_members'
      | 'optical_step_13_tube_routing'
      | 'optical_step_14_tray_entries'
      | 'optical_step_15_coiling_protectors'
      | 'optical_step_16_readable_labels'
    >
  >;
  /** Corrected extracted data from Phase 3 data validation. */
  extractedDataUpdates?: Partial<
    Pick<
      ConstructionQaReview,
      | 'extracted_pole_number'
      | 'extracted_pole_height'
      | 'extracted_cable_type'
      | 'extracted_joint_type'
      | 'extracted_splice_count'
    >
  >;
  notes?: string;
  reviewedBy: string;
}

/** Response for POST /api/construction-qa/review. */
export interface ReviewActionResponse {
  success: boolean;
  reviewId: string;
  updatedFields: string[];
  error?: string;
}

// ── Final decision ────────────────────────────────────────────────────────────

/**
 * Body for POST /api/construction-qa/final-decision (Phase 4).
 * Mandatory fields vary by decision — see PRD section 10.5 for validation rules.
 */
export interface FinalDecisionRequest {
  reviewId: string;
  decision: QaDecision;
  /** One or more standardized rejection/rework reason codes. */
  reasonCodes: QaReasonCode[];
  /** Free-text notes — mandatory for FAIL and REWORK_NEEDED. */
  notes: string;
  /** ISO date string — required when decision is REWORK_NEEDED. */
  resubmissionDate?: string;
  /** If true, also trigger WhatsApp feedback in the same request. */
  sendFeedback: boolean;
  /** Override the auto-generated WhatsApp message when sendFeedback is true. */
  feedbackMessage?: string;
  decidedBy: string;
}

/** Response for POST /api/construction-qa/final-decision. */
export interface FinalDecisionResponse {
  success: boolean;
  reviewId: string;
  decision: QaDecision;
  waSent: boolean;
  waError?: string;
  error?: string;
}

// ── Send feedback ─────────────────────────────────────────────────────────────

/** Body for POST /api/construction-qa/send-feedback (Phase 5). */
export interface SendFeedbackRequest {
  reviewId: string;
  /** Target WhatsApp group JID. Falls back to project config if omitted. */
  groupJid?: string;
  /** Direct technician phone for 1:1 message (alternative to group). */
  technicianPhone?: string;
  /** Complete WhatsApp message to send. Auto-generated if omitted. */
  message?: string;
  sentBy: string;
}

/** Response for POST /api/construction-qa/send-feedback. */
export interface SendFeedbackResponse {
  success: boolean;
  reviewId: string;
  sent: boolean;
  message: string;
  sentAt: string | null; // ISO timestamp
  error?: string;
}

// ── Photo proxy ───────────────────────────────────────────────────────────────

/**
 * Query parameters for GET /api/construction-qa/photo-proxy.
 * The proxy abstracts storage backends so the UI never needs credentials.
 */
export interface PhotoProxyRequest {
  /** Source-specific storage key (MinIO path, SharePoint item ID, Firebase path). */
  key: string;
  source: PhotoSource;
  /** Max width for on-the-fly resize (optional — defaults to original size). */
  width?: number;
}

// ── Ingestion triggers ────────────────────────────────────────────────────────

/** Body for POST /api/construction-qa/ingest-qfield. */
export interface QFieldIngestRequest {
  projectId: string;
  /** Target a specific QFieldCloud project UUID (optional). */
  qfieldProjectId?: string;
  /** Limit ingestion to one discipline or both. */
  discipline?: Discipline | 'all';
  /** Only ingest photos captured after this ISO date string. */
  sinceDate?: string;
  /** Simulate ingestion without writing to the database. */
  dryRun?: boolean;
}

/** Body for POST /api/construction-qa/ingest-sharepoint. */
export interface SharePointIngestRequest {
  projectId: string;
  discipline?: Discipline | 'all';
  sinceDate?: string;
  dryRun?: boolean;
}

/** Shared response shape for ingestion trigger endpoints. */
export interface IngestResponse {
  success: boolean;
  projectId: string;
  photosFound: number;
  photosIngested: number;
  reviewsCreated: number;
  reviewsUpdated: number;
  dryRun: boolean;
  errors: string[];
}

// ── Health check ──────────────────────────────────────────────────────────────

/** Service status entry in the health check response. */
export interface ServiceStatus {
  status: 'up' | 'down' | 'disabled';
  latencyMs: number;
}

/** Response for GET /api/construction-qa/health-check. */
export interface HealthCheckResponse {
  overall: 'healthy' | 'degraded' | 'down';
  services: {
    vlm: ServiceStatus;
    wa_bridge: ServiceStatus;
    minio: ServiceStatus;
    sharepoint: ServiceStatus;
    database: ServiceStatus;
  };
  queue: {
    vlm_pending: number;
    vlm_failed: number;
    wa_pending: number;
    review_pending: number;
  };
}

// ============================================================================
// QA WIZARD TYPES
// ============================================================================

/** The five sequential phases of the construction QA wizard. */
export type QaWizardPhase =
  | 'prerequisites'
  | 'photo_review'
  | 'data_validation'
  | 'final_decision'
  | 'feedback'
  | 'completed';

/** Step coverage map: step number → array of photo IDs assigned to it. */
export type StepCoverage = Record<number, string[]>;

/**
 * Full state of the 5-phase QA wizard for a single feature review.
 * Held in component state and not persisted to the database directly;
 * individual phase completions persist via their respective API calls.
 */
export interface QaWizardState {
  phase: QaWizardPhase;

  prerequisites: {
    passed: boolean;
    checked: boolean;
    photosAvailable: boolean;
    photoCount: number;
    stepsWithPhotos: number[];
    stepsMissingPhotos: number[];
    vlmReady: boolean;
    featureExists: boolean;
  };

  photoReview: {
    completed: boolean;
    stepsCovered: number[];
    stepsMissing: number[];
    stepCoverage: StepCoverage;
    totalPhotos: number;
  };

  dataValidation: {
    completed: boolean;
    extractedPoleNumber: string | null;
    extractedCableType: string | null;
    extractedJointLabel: string | null;
    extractedSpliceCount: number | null;
    fieldMatches: Record<string, boolean>;
    overrides: Record<string, string>;
  };

  finalDecision: {
    decision: QaDecision | null;
    reasonCodes: QaReasonCode[];
    notes: string | null;
    resubmissionDate: string | null;
    decidedAt: string | null;
    decidedBy: string | null;
    autoSuggestedDecision: QaDecision | null;
    autoSuggestedReasons: QaReasonCode[];
  };

  feedback: {
    sent: boolean;
    sentAt: string | null;
    message: string | null;
    waError: string | null;
  };
}

// ============================================================================
// REPORTING TYPES
// ============================================================================

/** Common filter parameters accepted by all reporting endpoints. */
export interface ReportingFilters {
  projectId: string;
  startDate?: string;
  endDate?: string;
  zoneNo?: number;
  ponNo?: number;
  discipline?: Discipline;
}

/** Project-level KPI summary returned by /reporting/overview. */
export interface OverviewReport {
  projectId: string;
  projectName: string;
  totalFeatures: number;
  featuresQad: number;
  overallPassRate: number;
  avgPhotosPerFeature: number;
  avgVlmConfidence: number;
  featuresPendingReview: number;
  featuresRequiringRework: number;
  byDiscipline: Record<
    Discipline,
    {
      total: number;
      passed: number;
      failed: number;
      passRate: number;
    }
  >;
}

/**
 * DR Photo Unified - Type Definitions
 *
 * Purpose: TypeScript interfaces for the unified photo review system
 * Status: WORKING - Core types for Phase 1 implementation
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - Database schema alignment
 * - Null safety with explicit | null unions
 *
 * NLNH Confidence: HIGH
 * - Types match database schema exactly
 * - Based on approved PRD and plan
 */

/**
 * Photo source types
 */
export type PhotoSource = 'onemap' | 'boss' | 'local';

/**
 * AI evaluation status
 */
export type AIEvaluationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * AI overall status (pass/fail)
 */
export type AIOverallStatus = 'PASS' | 'FAIL';

/**
 * Individual photo metadata
 */
export interface Photo {
  /** Photo filename (e.g., DR1730550_ph_prop_001.jpg) */
  filename: string;

  /** Unified step number (1-10) or null if unmapped */
  step: number | null;

  /** Full URL to photo (absolute or proxy URL) */
  url: string;

  /** Optional: File size in bytes */
  size?: number;

  /** Optional: Last modified timestamp (Unix epoch) */
  modified?: number;
}

/**
 * Photo source response (from fetch services)
 */
export interface PhotoSourceResponse {
  /** Which source provided the photos */
  source: PhotoSource;

  /** Total number of photos */
  count: number;

  /** Array of photo metadata */
  photos: Photo[];

  /** Optional error message if fetch failed */
  error?: string;
}

/**
 * AI step evaluation result
 */
export interface AIStepResult {
  /** Step number (1-10) */
  step: number;

  /** Step label (e.g., "House Photo") */
  label: string;

  /** Did the step pass AI evaluation? */
  passed: boolean;

  /** AI confidence score (0-10) */
  score: number;

  /** AI comment/feedback for this step */
  comment: string;

  /** Optional: Photos evaluated for this step */
  photos?: string[];
}

/**
 * Unified Review Record (matches dr_photo_unified_reviews table)
 *
 * This interface aligns exactly with the database schema.
 * All nullable columns have explicit | null union types.
 */
export interface UnifiedReview {
  // Primary identification
  id: string; // UUID
  drop_number: string; // Unique DR number
  project: string | null;

  // Photo metadata
  photo_source: PhotoSource | null;
  photo_count: number;
  photos_metadata: Photo[];

  // 10 unified QA steps (manual review)
  // NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
  // barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields
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

  // Incorrect tracking (manual review)
  incorrect_steps: string[]; // Array of step numbers marked as incorrect
  incorrect_comments: Record<string, string>; // { step_number: "comment" }

  // AI evaluation results
  ai_evaluation_status: AIEvaluationStatus | null;
  ai_overall_status: AIOverallStatus | null;
  ai_average_score: number | null;
  ai_step_results: AIStepResult[] | null;
  ai_markdown_report: string | null;
  ai_evaluated_at: Date | null;

  // Serial scanning (WA Monitor integration)
  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;

  // Locking (concurrent edit prevention)
  locked_by: string | null;
  locked_at: Date | null;

  // WhatsApp feedback
  feedback_sent: boolean;
  feedback_message: string | null;
  feedback_sent_at: Date | null;

  // Auto-QA
  auto_qa_processed: boolean;
  auto_qa_processed_at: Date | null;
  auto_qa_results: Record<string, unknown> | null;

  // Metadata
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Step label mapping (for UI display)
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields.
 */
export const STEP_LABELS: Record<number, string> = {
  0: 'Discard - Rubbish',
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Cable Entry Outside',
  4: 'Cable Entry Inside',
  5: 'Wall for Installation',
  6: 'ONT Back After Install',
  7: 'Power Meter Reading',
  8: 'Final Installation',
  9: 'Green Lights on ONT',
  10: 'Signature',
};

/**
 * Create unified review payload (for API)
 */
export interface CreateUnifiedReviewPayload {
  drop_number: string;
  project?: string;
}

/**
 * Update unified review payload (for API)
 */
export interface UpdateUnifiedReviewPayload {
  // Manual QA step updates (10 photo steps)
  step_01_house_photo?: boolean;
  step_02_cable_from_pole?: boolean;
  step_03_entry_outside?: boolean;
  step_04_entry_inside?: boolean;
  step_05_wall?: boolean;
  step_06_ont_back?: boolean;
  step_07_power_meter?: boolean;
  step_08_final_installation?: boolean;
  step_09_green_lights?: boolean;
  step_10_signature?: boolean;

  // Incorrect tracking
  incorrect_steps?: string[];
  incorrect_comments?: Record<string, string>;

  // Serial scanning
  ont_serial_scanned?: string;
  ups_serial_scanned?: string;

  // Feedback
  feedback_message?: string;

  // Metadata
  reviewed_by?: string;
}

/**
 * Fetch photos options
 */
export interface FetchPhotosOptions {
  /** Force a specific source (for testing/debugging) */
  forceSource?: PhotoSource;

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * OneMap API response (port 8003)
 *
 * PARTIAL: Structure based on existing port 8003 API
 * May need updates after integration testing
 */
export interface OneMapAPIResponse {
  total_drs: number;
  drs: Array<{
    dr_number: string;
    project: string;
    photos: Array<{
      filename: string;
      modified: number;
    }>;
  }>;
}

/**
 * BOSS API response (port 8001)
 *
 * PARTIAL: Structure based on existing BOSS API
 * May need updates after integration testing
 */
export interface BossAPIResponse {
  total_drs: number;
  drs: Array<{
    dr_number: string;
    project: string;
    photos: Array<{
      filename: string;
      modified: number;
    }>;
  }>;
}

// ============================================================================
// VLM CATEGORIZATION TYPES
// ============================================================================

/**
 * VLM Categorization status
 */
export type VlmCategorizationStatus = 'pending' | 'processing' | 'categorized' | 'approved' | 'failed';

/**
 * VLM categorization result for a single photo
 */
export interface VlmCategorizationResult {
  /** Photo filename */
  photo_filename: string;

  /** Original type from OneMap (e.g., 'ph_prop') */
  original_type: string | null;

  /** Original step based on OneMap type */
  original_step: number | null;

  /** VLM predicted category name */
  vlm_predicted_category: string;

  /** VLM predicted step number (1-10) */
  vlm_predicted_step: number;

  /** VLM confidence score (0.0 - 1.0) */
  vlm_confidence: number;

  /** What the VLM identified in the photo */
  vlm_identified_as: string;

  /** VLM reasoning for the classification */
  vlm_reasoning: string;

  /** Has human approved this categorization? */
  human_approved: boolean | null;

  /** Human override step if they disagreed */
  human_override_step: number | null;

  /** Human reason for override */
  human_override_reason: string | null;
}

/**
 * VLM batch categorization response
 */
export interface VlmBatchCategorizationResponse {
  categorizations: Array<{
    photo_index: number;
    identified_as: string;
    predicted_category: string;
    predicted_step: number;
    confidence: number;
    reasoning: string;
  }>;
}

/**
 * Categorize photos request
 */
export interface CategorizePhotosRequest {
  dropNumber: string;
  force?: boolean;
  batchSize?: number;
}

/**
 * Categorize photos response
 */
export interface CategorizePhotosResponse {
  dropNumber: string;
  status: 'processing' | 'categorized' | 'failed';
  photoCount: number;
  categorizations: VlmCategorizationResult[];
  processingTimeMs: number;
  error?: string;
  /** Auto-approval tiers for each photo */
  autoApprovalTiers?: AutoApprovalResult[];
  /** Summary of auto-approval breakdown */
  autoApprovalSummary?: AutoApprovalSummary;
}

/**
 * Approve categorization request
 */
export interface ApproveCategorizeRequest {
  dropNumber: string;
  approvals: Array<{
    photo_filename: string;
    approved: boolean;
    override_step?: number;
    override_reason?: string;
  }>;
  approve_all?: boolean;
}

/**
 * Approve categorization response
 */
export interface ApproveCategorizeResponse {
  dropNumber: string;
  status: 'approved' | 'partial';
  approved_count: number;
  overridden_count: number;
  photos_metadata: Photo[];
}

/**
 * Auto-approval tier for VLM categorization
 * Determines how much human review is needed
 */
export type AutoApprovalTier = 'auto_approved' | 'review_recommended' | 'human_required';

/**
 * Auto-approval result for a single photo
 */
export interface AutoApprovalResult {
  photo_filename: string;
  tier: AutoApprovalTier;
  reason: string;
}

/**
 * Auto-approval summary for UI display
 */
export interface AutoApprovalSummary {
  autoApproved: number;
  reviewRecommended: number;
  humanRequired: number;
  totalPhotos: number;
  overallAccuracy: number | null;
}

/**
 * Extended UnifiedReview with VLM categorization fields
 */
export interface UnifiedReviewWithCategorization extends UnifiedReview {
  vlm_categorization_status: VlmCategorizationStatus;
  vlm_categorization_results: VlmCategorizationResult[];
  vlm_categorized_at: Date | null;
  vlm_approved_by: string | null;
  vlm_approved_at: Date | null;
}

// ============================================================================
// QA WIZARD TYPES
// ============================================================================

/**
 * QA Wizard phases
 */
export type QaWizardPhase =
  | 'prerequisites'
  | 'photo_review'
  | 'data_validation'
  | 'final_decision'
  | 'feedback'
  | 'completed';

/**
 * QA final decision
 */
export type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED';

/**
 * Fail reason codes
 */
export type FailReasonCode =
  | 'MISSING_PHOTOS'
  | 'MISSING_SERIAL'
  | 'SERIAL_MISMATCH'
  | 'DR_NUMBER_MISMATCH'
  | 'POWER_OUT_OF_RANGE'
  | 'DISCARDED_CRITICAL';

/**
 * Power meter validation status
 */
export type PowerMeterStatus = 'pass' | 'fail_high' | 'fail_low' | 'manual' | 'pending';

/**
 * Serial validation status (3-way check)
 */
export type SerialValidationStatus = 'match' | 'mismatch' | 'partial' | 'manual' | 'pending';

/**
 * QA Wizard state
 */
export interface QaWizardState {
  phase: QaWizardPhase;
  prerequisites: {
    passed: boolean;
    checked: boolean;
    failures: FailReasonCode[];
    photosAvailable: boolean;
    photoCount: number;
    ontSerialPresent: boolean;
    ontSerial: string | null;
    upsSerialPresent: boolean;
    upsSerial: string | null;
  };
  photoReview: {
    completed: boolean;
    stepsCovered: number[];
    stepsMissing: number[];
    totalPhotos: number;
    categorizedPhotos: number;
  };
  dataValidation: {
    completed: boolean;
    powerMeter: {
      status: PowerMeterStatus;
      value: number | null;
      inRange: boolean;
    };
    serialValidation: {
      status: SerialValidationStatus;
      onemapSerial: string | null;
      step6Serial: string | null;
      step9Serial: string | null;
      step9DrNumber: string | null;
      ontMatch: boolean;
      drMatch: boolean;
    };
  };
  finalDecision: {
    decision: QaDecision | null;
    reasons: FailReasonCode[];
    /** Internal notes for QA team (NOT sent to technicians) */
    internalNotes: string | null;
    /** Technician feedback (sent via WhatsApp) */
    technicianFeedback: string | null;
    /** Combined notes for backward compatibility (deprecated) */
    notes: string | null;
    decidedAt: string | null;
    decidedBy: string | null;
  };
  feedback: {
    sent: boolean;
    sentAt: string | null;
    message: string | null;
  };
}

/**
 * Extended UnifiedReview with QA Wizard fields
 */
export interface UnifiedReviewWithQaWizard extends UnifiedReviewWithCategorization {
  qa_phase: QaWizardPhase;
  qa_decision: QaDecision | null;
  qa_decision_reasons: FailReasonCode[];
  qa_decision_at: Date | null;
  qa_decision_by: string | null;
  qa_decision_notes: string | null;
  vlm_power_meter_dbm: number | null;
  vlm_power_meter_status: PowerMeterStatus | null;
  vlm_ont_serial_step6: string | null;
  vlm_ont_serial_step9: string | null;
  vlm_dr_number_step9: string | null;
  serial_validation_status: SerialValidationStatus | null;
  prerequisites_passed: boolean | null;
  photo_review_completed: boolean;
  data_validation_completed: boolean;
  onemap_ont_serial: string | null;
  onemap_ups_serial: string | null;
  step_coverage: Record<number, string[]>;
  missing_steps: number[];
}

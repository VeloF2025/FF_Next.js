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

  /** Unified step number (1-12) or null if unmapped */
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
}

/**
 * AI step evaluation result
 */
export interface AIStepResult {
  /** Step number (1-12) */
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

  // 12 unified QA steps (manual review)
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_entry_outside: boolean;
  step_04_entry_inside: boolean;
  step_05_wall: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_ont_barcode: boolean;
  step_09_ups_serial: boolean;
  step_10_final_installation: boolean;
  step_11_green_lights: boolean;
  step_12_signature: boolean;

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

  // Metadata
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Step label mapping (for UI display)
 */
export const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Cable Entry Outside',
  4: 'Cable Entry Inside',
  5: 'Wall for Installation',
  6: 'ONT Back After Install',
  7: 'Power Meter Reading',
  8: 'ONT Barcode',
  9: 'UPS Serial Number',
  10: 'Final Installation',
  11: 'Green Lights on ONT',
  12: 'Signature',
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
  // Manual QA step updates
  step_01_house_photo?: boolean;
  step_02_cable_from_pole?: boolean;
  step_03_entry_outside?: boolean;
  step_04_entry_inside?: boolean;
  step_05_wall?: boolean;
  step_06_ont_back?: boolean;
  step_07_power_meter?: boolean;
  step_08_ont_barcode?: boolean;
  step_09_ups_serial?: boolean;
  step_10_final_installation?: boolean;
  step_11_green_lights?: boolean;
  step_12_signature?: boolean;

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

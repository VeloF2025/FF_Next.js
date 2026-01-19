/**
 * Ticketing Module - Verification & QA Readiness Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for 12-step verification workflow,
 * QA readiness validation, and pre-QA checks.
 */

/**
 * Verification Step Interface
 * Tracks completion of each of the 12 verification steps
 */
export interface VerificationStep {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets
  step_number: number; // 1-12
  step_name: string;
  step_description: string | null;

  // Completion tracking
  is_complete: boolean;
  completed_at: Date | null;
  completed_by: string | null; // UUID reference to users

  // Evidence tracking
  photo_required: boolean;
  photo_url: string | null;
  photo_verified: boolean; // Photo passed quality check
  notes: string | null;

  // Timestamp
  created_at: Date;
}

/**
 * Verification step numbers (1-12)
 */
export type VerificationStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * Create verification step payload
 */
export interface CreateVerificationStepPayload {
  ticket_id: string;
  step_number: VerificationStepNumber;
  step_name: string;
  step_description?: string;
  photo_required?: boolean;
}

/**
 * Update verification step payload
 */
export interface UpdateVerificationStepPayload {
  is_complete?: boolean;
  completed_by?: string;
  photo_url?: string;
  photo_verified?: boolean;
  notes?: string;
}

/**
 * Verification progress summary
 */
export interface VerificationProgress {
  ticket_id: string;
  total_steps: number;
  completed_steps: number;
  pending_steps: number;
  progress_percentage: number;
  all_steps_complete: boolean;
  steps: VerificationStep[];
}

/**
 * QA Readiness Check Result
 * Pre-QA validation to ensure ticket meets quality gates
 */
export interface QAReadinessCheck {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets

  // Overall result
  passed: boolean;
  checked_at: Date;
  checked_by: string | null; // UUID reference to users (NULL for system checks)

  // Individual check results
  photos_exist: boolean | null;
  photos_count: number | null;
  photos_required_count: number | null;
  dr_populated: boolean | null;
  pole_populated: boolean | null;
  pon_populated: boolean | null;
  zone_populated: boolean | null;
  ont_serial_recorded: boolean | null;
  ont_rx_recorded: boolean | null;
  platforms_aligned: boolean | null; // SP, SOW, tracker all match

  // Failure details
  failed_checks: QAReadinessFailedCheck[] | null; // JSONB array

  // Timestamp
  created_at: Date;
}

/**
 * Failed check detail
 */
export interface QAReadinessFailedCheck {
  check_name: string;
  reason: string;
  expected?: string | number;
  actual?: string | number;
}

/**
 * QA Readiness check names
 */
export enum QAReadinessCheckName {
  PHOTOS_EXIST = 'photos_exist',
  DR_POPULATED = 'dr_populated',
  POLE_POPULATED = 'pole_populated',
  PON_POPULATED = 'pon_populated',
  ZONE_POPULATED = 'zone_populated',
  ONT_SERIAL_RECORDED = 'ont_serial_recorded',
  ONT_RX_RECORDED = 'ont_rx_recorded',
  PLATFORMS_ALIGNED = 'platforms_aligned',
}

/**
 * Create QA readiness check payload
 */
export interface CreateQAReadinessCheckPayload {
  ticket_id: string;
  checked_by?: string; // NULL for automated system checks
}

/**
 * QA Readiness check result summary
 */
export interface QAReadinessResult {
  passed: boolean;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failures: QAReadinessFailedCheck[];
  can_start_qa: boolean;
  blocking_issues: string[];
}

/**
 * QA Readiness status for a ticket
 */
export interface QAReadinessStatus {
  ticket_id: string;
  is_ready: boolean;
  last_check: QAReadinessCheck | null;
  last_check_at: Date | null;
  failed_reasons: string[] | null;
  next_action: string;
}

/**
 * Photo evidence requirement
 */
export interface PhotoRequirement {
  step_number: VerificationStepNumber;
  step_name: string;
  required: boolean;
  uploaded: boolean;
  verified: boolean;
  photo_url: string | null;
}

/**
 * Verification step template (constant definition)
 */
export interface VerificationStepTemplate {
  step_number: VerificationStepNumber;
  name: string;
  description: string;
  photo_required: boolean;
  critical: boolean; // Blocking for QA approval
}

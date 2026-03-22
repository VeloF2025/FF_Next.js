/**
 * Auto-Fail Types
 *
 * Purpose: Shared type definitions for the QA auto-fail pipeline.
 * Extracted to avoid circular imports between serialValidator,
 * drValidationEngine, and autoFailEvaluation.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

// ============================================================================
// FAIL REASON CODES
// ============================================================================

/**
 * Fail reason codes for tracking (INTERNAL QA).
 */
export type FailReasonCode =
  | 'MISSING_PHOTOS'
  | 'MISSING_SERIAL'
  | 'SERIAL_MISMATCH'
  | 'DR_NUMBER_MISMATCH'
  | 'POWER_OUT_OF_RANGE'
  | 'DISCARDED_CRITICAL';

/**
 * Technician-actionable issue codes (for WhatsApp feedback).
 * These are issues the technician can actually fix.
 */
export type TechnicianIssueCode =
  | 'ONT_NOT_SCANNED'      // ONT serial missing from 1Map
  | 'UPS_NOT_SCANNED'      // UPS/Gizzu serial missing from 1Map
  | 'SERIALS_SWAPPED'      // ONT has Gizzu format or vice versa
  | 'ONT_INVALID_FORMAT'   // ONT serial doesn't match ALCL/ALCB pattern
  | 'UPS_INVALID_FORMAT'   // UPS serial format invalid
  | 'MISSING_PHOTOS'       // Missing installation step photos
  | 'POWER_OUT_OF_RANGE';  // Power meter issue (technician may need to re-test)

export interface TechnicianIssue {
  code: TechnicianIssueCode;
  message: string;
  severity: 'error' | 'warning';
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Prerequisites check result.
 */
export interface PrerequisitesResult {
  passed: boolean;
  failures: FailReasonCode[];
  details: {
    photosAvailable: boolean;
    photoCount: number;
    ontSerialPresent: boolean;
    ontSerialValid: boolean;
    ontSerial: string | null;
    upsSerialPresent: boolean;
    upsSerialValid: boolean;
    upsSerial: string | null;
  };
}

/**
 * Step coverage result.
 */
export interface StepCoverageResult {
  total: number;
  covered: number[];
  missing: number[];
  coverageMap: Record<number, string[]>; // step -> filenames
  complete: boolean;
}

/**
 * Power meter validation result.
 */
export interface PowerMeterResult {
  status: 'pass' | 'fail_high' | 'fail_low' | 'manual' | 'pending';
  value: number | null;
  inRange: boolean;
  message: string;
}

/**
 * Serial validation result (3-way check).
 */
export interface SerialValidationResult {
  status: 'match' | 'mismatch' | 'partial' | 'manual' | 'pending';
  onemapSerial: string | null;
  step6Serial: string | null;
  step9Serial: string | null;
  step9DrNumber: string | null;
  expectedDrNumber: string;
  ontMatch: boolean;
  drMatch: boolean;
  details: string;
}

/**
 * Auto-fail evaluation result.
 */
export interface AutoFailResult {
  autoFail: boolean;
  reasons: FailReasonCode[];
  recommendation: 'PASS' | 'FAIL' | 'REWORK_NEEDED';
  summary: string;
}

/**
 * DR data for validation.
 */
export interface DrValidationData {
  drNumber: string;
  photoCount: number;
  photos: Array<{ filename: string; step: number | null }>;
  ontSerial: string | null; // from OneMap
  upsSerial: string | null; // from OneMap
  powerMeterDbm: number | null;
  vlmOntSerialStep6: string | null;
  vlmOntSerialStep9: string | null;
  vlmDrNumberStep9: string | null;
}

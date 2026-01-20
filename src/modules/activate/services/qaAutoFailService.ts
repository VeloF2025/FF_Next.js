/**
 * QA Auto-Fail Service
 *
 * Purpose: Handle automatic pass/fail logic for QA Wizard prerequisites
 * Status: WORKING - Phase 1 implementation
 *
 * Following PAI principles:
 * - TYPE_SAFETY: 100% TypeScript coverage
 * - No magic numbers - all thresholds documented
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Fail reason codes for tracking (INTERNAL QA)
 */
export type FailReasonCode =
  | 'MISSING_PHOTOS'
  | 'MISSING_SERIAL'
  | 'SERIAL_MISMATCH'
  | 'DR_NUMBER_MISMATCH'
  | 'POWER_OUT_OF_RANGE'
  | 'DISCARDED_CRITICAL';

/**
 * Technician-actionable issue codes (for WhatsApp feedback)
 * These are issues the technician can actually fix
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

/**
 * Prerequisites check result
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
 * Step coverage result
 */
export interface StepCoverageResult {
  total: number;
  covered: number[];
  missing: number[];
  coverageMap: Record<number, string[]>; // step -> filenames
  complete: boolean;
}

/**
 * Power meter validation result
 */
export interface PowerMeterResult {
  status: 'pass' | 'fail_high' | 'fail_low' | 'manual' | 'pending';
  value: number | null;
  inRange: boolean;
  message: string;
}

/**
 * Serial validation result (3-way check)
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
 * Auto-fail evaluation result
 */
export interface AutoFailResult {
  autoFail: boolean;
  reasons: FailReasonCode[];
  recommendation: 'PASS' | 'FAIL' | 'REWORK_NEEDED';
  summary: string;
}

/**
 * DR data for validation
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

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fuzzy matching threshold - max character differences allowed
 * 2 characters allows for common OCR errors like:
 * - ALCLB48AD3W vs ALCLB48AD39F (2 chars)
 * - ALCLB4ACB04 vs ALCLB48ACB04 (1 char missing)
 */
const FUZZY_MATCH_MAX_DISTANCE = 2;

/**
 * Minimum confidence for fuzzy match (0-1)
 * With 12-char serials, 2 errors = 83% confidence
 */
const FUZZY_MATCH_MIN_CONFIDENCE = 0.80;

/**
 * ONT Serial regex pattern (Nokia ONT)
 * Matches: ALCLB463EE35, ALCB480FE3D, ALCLB48CC3CA
 * Format: ALCL or ALCB followed by alphanumeric
 */
const ONT_SERIAL_PATTERN = /^ALC[LB][A-Z0-9]{7,10}$/i;

/**
 * Gizzu UPS Serial regex pattern
 * Matches: GU18W12V2508057584, GU18W12V2508035029
 * Format: GU18W followed by alphanumeric (typically 15-20 chars total)
 */
const GIZZU_SERIAL_PATTERN = /^GU18W[A-Z0-9]{10,16}$/i;

/**
 * Power meter valid range (dBm)
 * - Above -18: FAIL (too high)
 * - Between -18 and -24: PASS
 * - Below -24: FAIL (too low)
 */
const POWER_METER_MIN = -24;
const POWER_METER_MAX = -18;

/**
 * UPS Serial length range (for non-Gizzu UPS)
 */
const UPS_SERIAL_MIN_LENGTH = 8;
const UPS_SERIAL_MAX_LENGTH = 20;

/**
 * Required steps (all 10 must be present)
 */
const REQUIRED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ============================================================================
// FUZZY MATCHING FUNCTIONS
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits (insertions, deletions, substitutions)
 * needed to transform one string into the other.
 *
 * Uses optimized space approach with two rows instead of full matrix.
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Edge cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix for space efficiency
  let prevRow: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let currRow: number[] = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        currRow[j] = prevRow[j - 1]!;
      } else {
        currRow[j] = 1 + Math.min(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          prevRow[j]!,      // deletion
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          currRow[j - 1]!,  // insertion
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          prevRow[j - 1]!   // substitution
        );
      }
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  // Result is in prevRow because we swapped at the end of last iteration
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return prevRow[n]!;
}

/**
 * Fuzzy serial matching result
 */
export interface FuzzyMatchResult {
  /** Whether the serials match (exact or fuzzy) */
  isMatch: boolean;
  /** Whether this was an exact match */
  isExactMatch: boolean;
  /** Whether this was a fuzzy match (close but not exact) */
  isFuzzyMatch: boolean;
  /** Number of character differences */
  distance: number;
  /** Confidence level (0-1, where 1 = exact match) */
  confidence: number;
  /** Human-readable description */
  details: string;
}

/**
 * Fuzzy match two serial numbers
 *
 * Handles common OCR errors like:
 * - ALCLB48AD3W vs ALCLB48AD39F (W vs 9F = 2 chars)
 * - ALCLB4ACB04 vs ALCLB48ACB04 (missing 8 = 1 char)
 * - ALCLB48CC3CA vs ALCLB488CC3CA (extra 8 = 1 char)
 *
 * @param serial1 - First serial to compare (typically from VLM extraction)
 * @param serial2 - Second serial to compare (typically from OneMap)
 * @returns FuzzyMatchResult with match status and confidence
 */
export function fuzzySerialMatch(
  serial1: string | null,
  serial2: string | null
): FuzzyMatchResult {
  // Handle null/empty cases
  if (!serial1 || !serial2) {
    return {
      isMatch: false,
      isExactMatch: false,
      isFuzzyMatch: false,
      distance: -1,
      confidence: 0,
      details: serial1 ? 'Second serial is null/empty' : 'First serial is null/empty',
    };
  }

  // Normalize both serials (uppercase, no spaces/dashes)
  const s1 = serial1.trim().toUpperCase().replace(/[\s-]/g, '');
  const s2 = serial2.trim().toUpperCase().replace(/[\s-]/g, '');

  // Exact match check first
  if (s1 === s2) {
    return {
      isMatch: true,
      isExactMatch: true,
      isFuzzyMatch: false,
      distance: 0,
      confidence: 1.0,
      details: 'Exact match',
    };
  }

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(s1, s2);

  // Calculate confidence based on longer string length
  const maxLen = Math.max(s1.length, s2.length);
  const confidence = maxLen > 0 ? 1 - distance / maxLen : 0;

  // Check if within fuzzy match threshold
  const isFuzzyMatch =
    distance <= FUZZY_MATCH_MAX_DISTANCE &&
    confidence >= FUZZY_MATCH_MIN_CONFIDENCE;

  // Generate details
  let details: string;
  if (isFuzzyMatch) {
    details = `Fuzzy match: ${distance} character difference(s) (${(confidence * 100).toFixed(0)}% confidence)`;
  } else if (distance <= FUZZY_MATCH_MAX_DISTANCE) {
    details = `Near match but below confidence threshold: ${distance} diff, ${(confidence * 100).toFixed(0)}% confidence (min: ${FUZZY_MATCH_MIN_CONFIDENCE * 100}%)`;
  } else {
    details = `No match: ${distance} character differences (max allowed: ${FUZZY_MATCH_MAX_DISTANCE})`;
  }

  log.debug('QaAutoFail', `Fuzzy match: "${s1}" vs "${s2}" = ${isFuzzyMatch ? 'MATCH' : 'NO MATCH'}`, {
    distance,
    confidence: `${(confidence * 100).toFixed(1)}%`,
    maxAllowed: FUZZY_MATCH_MAX_DISTANCE,
  });

  return {
    isMatch: isFuzzyMatch,
    isExactMatch: false,
    isFuzzyMatch,
    distance,
    confidence,
    details,
  };
}

/**
 * Check if two serials match (exact or fuzzy)
 * Convenience function that returns just boolean
 */
export function serialsMatchFuzzy(serial1: string | null, serial2: string | null): boolean {
  const result = fuzzySerialMatch(serial1, serial2);
  return result.isMatch;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate ONT serial format
 */
export function validateOntSerial(serial: string | null): { valid: boolean; reason: string } {
  if (!serial) {
    return { valid: false, reason: 'ONT serial not provided' };
  }

  const trimmed = serial.trim();
  if (trimmed.length < 11 || trimmed.length > 12) {
    return { valid: false, reason: `Invalid length: ${trimmed.length} (expected 11-12)` };
  }

  if (!ONT_SERIAL_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'Does not match ALCL/ALCB pattern' };
  }

  return { valid: true, reason: 'Valid ONT serial format' };
}

/**
 * Validate UPS serial format
 */
export function validateUpsSerial(serial: string | null): { valid: boolean; reason: string } {
  if (!serial) {
    return { valid: false, reason: 'UPS serial not provided' };
  }

  const trimmed = serial.trim();
  if (trimmed.length < UPS_SERIAL_MIN_LENGTH || trimmed.length > UPS_SERIAL_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Invalid length: ${trimmed.length} (expected ${UPS_SERIAL_MIN_LENGTH}-${UPS_SERIAL_MAX_LENGTH})`,
    };
  }

  return { valid: true, reason: 'Valid UPS serial format' };
}

/**
 * Validate power meter reading
 */
export function validatePowerMeter(dbm: number | null): PowerMeterResult {
  if (dbm === null || dbm === undefined) {
    return {
      status: 'pending',
      value: null,
      inRange: false,
      message: 'Power meter reading not yet extracted',
    };
  }

  if (dbm > POWER_METER_MAX) {
    return {
      status: 'fail_high',
      value: dbm,
      inRange: false,
      message: `${dbm} dBm is too high (max: ${POWER_METER_MAX} dBm) - possible reflection/equipment issue`,
    };
  }

  if (dbm < POWER_METER_MIN) {
    return {
      status: 'fail_low',
      value: dbm,
      inRange: false,
      message: `${dbm} dBm is too low (min: ${POWER_METER_MIN} dBm) - signal loss detected`,
    };
  }

  return {
    status: 'pass',
    value: dbm,
    inRange: true,
    message: `${dbm} dBm is within valid range (${POWER_METER_MAX} to ${POWER_METER_MIN} dBm)`,
  };
}

// ============================================================================
// SERIAL TYPE DETECTION
// ============================================================================

/**
 * Check if a serial looks like a Nokia ONT serial (ALCL/ALCB pattern)
 */
export function looksLikeOntSerial(serial: string | null): boolean {
  if (!serial) return false;
  return ONT_SERIAL_PATTERN.test(serial.trim());
}

/**
 * Check if a serial looks like a Gizzu UPS serial (GU18W pattern)
 */
export function looksLikeGizzuSerial(serial: string | null): boolean {
  if (!serial) return false;
  return GIZZU_SERIAL_PATTERN.test(serial.trim());
}

/**
 * Mask a serial number for display (privacy + verification)
 * Shows first 3-4 chars and last 4 chars with *** in between
 * Examples:
 *   ALCLB48CC3CA -> ALC***3CA
 *   GU18W12V2508057584 -> GU18***7584
 */
export function maskSerial(serial: string | null): string {
  if (!serial) return 'N/A';
  const trimmed = serial.trim();
  if (trimmed.length <= 6) return trimmed; // Too short to mask

  // For ONT (ALC*), show first 3 + last 4
  if (trimmed.toUpperCase().startsWith('ALC')) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
  }

  // For Gizzu (GU18W), show first 4 + last 4
  if (trimmed.toUpperCase().startsWith('GU18')) {
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
  }

  // Generic: show first 3 + last 4
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
}

/**
 * Serial status type for detailed feedback
 */
export type SerialStatus =
  | 'present_valid'      // Serial is present and matches expected format
  | 'present_swapped'    // Serial is present but appears to be in wrong field
  | 'present_invalid'    // Serial is present but format doesn't match expected
  | 'missing';           // Serial is not present

/**
 * Get detailed serial status for feedback
 */
export function getSerialStatus(
  serial: string | null,
  expectedType: 'ont' | 'ups'
): { status: SerialStatus; message: string } {
  if (!serial) {
    return {
      status: 'missing',
      message: expectedType === 'ont'
        ? '❌ Not scanned in 1Map - please scan ONT barcode'
        : '❌ Not scanned in 1Map - please scan UPS barcode',
    };
  }

  const isOntFormat = looksLikeOntSerial(serial);
  const isGizzuFormat = looksLikeGizzuSerial(serial);
  const masked = maskSerial(serial);

  if (expectedType === 'ont') {
    // Expecting ONT (ALCL/ALCB)
    if (isOntFormat) {
      return {
        status: 'present_valid',
        message: `Present in 1Map ✓ (${masked})`,
      };
    }
    if (isGizzuFormat) {
      return {
        status: 'present_swapped',
        message: `⚠️ Wrong field - has Gizzu serial (${masked}) instead of ONT`,
      };
    }
    return {
      status: 'present_invalid',
      message: `⚠️ Invalid format (${masked}) - expected ALCL/ALCB serial`,
    };
  } else {
    // Expecting UPS/Gizzu (GU18W)
    if (isGizzuFormat) {
      return {
        status: 'present_valid',
        message: `Present in 1Map ✓ (${masked})`,
      };
    }
    if (isOntFormat) {
      return {
        status: 'present_swapped',
        message: `⚠️ Wrong field - has ONT serial (${masked}) instead of UPS`,
      };
    }
    return {
      status: 'present_invalid',
      message: `⚠️ Invalid format (${masked}) - expected GU18W serial`,
    };
  }
}

/**
 * Format serial validation results for WhatsApp feedback
 * Returns formatted lines for both ONT and UPS
 */
export function formatSerialFeedback(
  ontSerial: string | null,
  upsSerial: string | null
): { ontLine: string; upsLine: string; hasIssues: boolean } {
  const ontStatus = getSerialStatus(ontSerial, 'ont');
  const upsStatus = getSerialStatus(upsSerial, 'ups');

  const hasIssues =
    ontStatus.status !== 'present_valid' ||
    upsStatus.status !== 'present_valid';

  return {
    ontLine: `- ONT Serial: ${ontStatus.message}`,
    upsLine: `- UPS Serial: ${upsStatus.message}`,
    hasIssues,
  };
}

/**
 * Detect if ONT and UPS serials appear to be swapped
 * Returns details about the swap if detected
 */
export function detectSwappedSerials(
  ontSerial: string | null,
  upsSerial: string | null
): { swapped: boolean; details: string } {
  if (!ontSerial && !upsSerial) {
    return { swapped: false, details: 'No serials to check' };
  }

  const ontLooksLikeGizzu = looksLikeGizzuSerial(ontSerial);
  const upsLooksLikeOnt = looksLikeOntSerial(upsSerial);

  if (ontLooksLikeGizzu && upsLooksLikeOnt) {
    // Both are definitely swapped
    return {
      swapped: true,
      details: `Serials appear SWAPPED: ONT field has Gizzu serial (${ontSerial}), UPS field has ONT serial (${upsSerial})`,
    };
  }

  if (ontLooksLikeGizzu) {
    // ONT field has Gizzu serial
    return {
      swapped: true,
      details: `ONT field contains Gizzu serial (${ontSerial}) - please swap in 1Map`,
    };
  }

  if (upsLooksLikeOnt) {
    // UPS field has ONT serial
    return {
      swapped: true,
      details: `UPS field contains ONT serial (${upsSerial}) - please swap in 1Map`,
    };
  }

  return { swapped: false, details: 'Serials appear correctly assigned' };
}

/**
 * Get technician-actionable issues (for WhatsApp feedback)
 * These are issues the technician can actually fix - NOT internal VLM comparison data
 */
export function getTechnicianIssues(data: {
  ontSerial: string | null;
  upsSerial: string | null;
  photoCount: number;
  missingSteps: number[];
  powerMeterDbm: number | null;
}): TechnicianIssue[] {
  const issues: TechnicianIssue[] = [];

  // Check for missing serials
  if (!data.ontSerial) {
    issues.push({
      code: 'ONT_NOT_SCANNED',
      message: 'ONT serial not scanned in 1Map',
      severity: 'error',
    });
  }

  if (!data.upsSerial) {
    issues.push({
      code: 'UPS_NOT_SCANNED',
      message: 'UPS/Gizzu serial not scanned in 1Map',
      severity: 'error',
    });
  }

  // Check for swapped serials (this is a critical error)
  const swapCheck = detectSwappedSerials(data.ontSerial, data.upsSerial);
  if (swapCheck.swapped) {
    issues.push({
      code: 'SERIALS_SWAPPED',
      message: swapCheck.details,
      severity: 'error',
    });
  }

  // Check ONT serial format (if present but invalid)
  if (data.ontSerial && !swapCheck.swapped) {
    const ontValid = validateOntSerial(data.ontSerial);
    if (!ontValid.valid) {
      issues.push({
        code: 'ONT_INVALID_FORMAT',
        message: `ONT serial format invalid: ${ontValid.reason}`,
        severity: 'warning',
      });
    }
  }

  // Check UPS serial format (if present but invalid)
  if (data.upsSerial && !swapCheck.swapped) {
    // For UPS, accept either Gizzu format or general format
    const isGizzu = looksLikeGizzuSerial(data.upsSerial);
    const upsValid = validateUpsSerial(data.upsSerial);
    if (!isGizzu && !upsValid.valid) {
      issues.push({
        code: 'UPS_INVALID_FORMAT',
        message: `UPS serial format invalid: ${upsValid.reason}`,
        severity: 'warning',
      });
    }
  }

  // Check for missing photos
  if (data.missingSteps.length > 0) {
    issues.push({
      code: 'MISSING_PHOTOS',
      message: `Missing photos for steps: ${data.missingSteps.join(', ')}`,
      severity: 'error',
    });
  }

  // Check power meter
  if (data.powerMeterDbm !== null) {
    const pmResult = validatePowerMeter(data.powerMeterDbm);
    if (!pmResult.inRange) {
      issues.push({
        code: 'POWER_OUT_OF_RANGE',
        message: pmResult.message,
        severity: 'error',
      });
    }
  }

  return issues;
}

/**
 * Get human-readable description for technician issue
 */
export function getTechnicianIssueDescription(code: TechnicianIssueCode): string {
  const descriptions: Record<TechnicianIssueCode, string> = {
    ONT_NOT_SCANNED: 'Please scan the ONT serial barcode in 1Map',
    UPS_NOT_SCANNED: 'Please scan the UPS/Gizzu serial barcode in 1Map',
    SERIALS_SWAPPED: 'ONT and UPS serials appear to be swapped - please correct in 1Map',
    ONT_INVALID_FORMAT: 'ONT serial format is invalid - please rescan',
    UPS_INVALID_FORMAT: 'UPS serial format is invalid - please rescan',
    MISSING_PHOTOS: 'Please upload missing installation photos',
    POWER_OUT_OF_RANGE: 'Power meter reading is out of acceptable range',
  };

  return descriptions[code] || code;
}

// ============================================================================
// CHECK FUNCTIONS
// ============================================================================

/**
 * Check prerequisites before starting detailed review
 *
 * Auto-fail conditions:
 * - No photos
 * - Missing ONT serial (from OneMap)
 * - Missing UPS serial (from OneMap)
 */
export function checkPrerequisites(data: DrValidationData): PrerequisitesResult {
  log.debug('QaAutoFail', `Checking prerequisites for ${data.drNumber}`);

  const failures: FailReasonCode[] = [];

  // Check photos
  const photosAvailable = data.photoCount > 0;
  if (!photosAvailable) {
    failures.push('MISSING_PHOTOS');
  }

  // Check ONT serial
  const ontSerialPresent = !!data.ontSerial;
  const ontValidation = validateOntSerial(data.ontSerial);

  if (!ontSerialPresent) {
    failures.push('MISSING_SERIAL');
  }

  // Check UPS serial
  const upsSerialPresent = !!data.upsSerial;
  const upsValidation = validateUpsSerial(data.upsSerial);

  if (!upsSerialPresent) {
    // Only add MISSING_SERIAL once
    if (!failures.includes('MISSING_SERIAL')) {
      failures.push('MISSING_SERIAL');
    }
  }

  const passed = failures.length === 0;

  const result: PrerequisitesResult = {
    passed,
    failures,
    details: {
      photosAvailable,
      photoCount: data.photoCount,
      ontSerialPresent,
      ontSerialValid: ontValidation.valid,
      ontSerial: data.ontSerial,
      upsSerialPresent,
      upsSerialValid: upsValidation.valid,
      upsSerial: data.upsSerial,
    },
  };

  log.info('QaAutoFail', `Prerequisites ${passed ? 'PASSED' : 'FAILED'} for ${data.drNumber}`, {
    failures,
    photoCount: data.photoCount,
  });

  return result;
}

/**
 * Check step coverage from categorized photos
 */
export function checkStepCoverage(
  photos: Array<{ filename: string; step: number | null }>
): StepCoverageResult {
  const coverageMap: Record<number, string[]> = {};

  // Initialize all steps with empty arrays
  for (let step = 1; step <= 10; step++) {
    coverageMap[step] = [];
  }

  // Group photos by step
  for (const photo of photos) {
    if (photo.step !== null && photo.step >= 1 && photo.step <= 10) {
      const stepArray = coverageMap[photo.step];
      if (stepArray) {
        stepArray.push(photo.filename);
      }
    }
  }

  // Determine covered and missing steps
  const covered: number[] = [];
  const missing: number[] = [];

  for (const step of REQUIRED_STEPS) {
    if (coverageMap[step] && coverageMap[step].length > 0) {
      covered.push(step);
    } else {
      missing.push(step);
    }
  }

  return {
    total: REQUIRED_STEPS.length,
    covered,
    missing,
    coverageMap,
    complete: missing.length === 0,
  };
}

/**
 * Validate 3-way serial cross-reference with FUZZY MATCHING
 *
 * IMPORTANT: Step 6 (ONT back) is the definitive serial source because:
 * - The serial sticker is clearly visible on the back panel
 * - Step 9 (front/green lights) may have different labels or be harder to read
 *
 * Validation logic with fuzzy matching:
 * - Exact match → PASS immediately
 * - Fuzzy match (≤2 chars diff, ≥80% confidence) → PASS with note
 * - If Step 6 matches OneMap → PASS (ignore Step 9 mismatch)
 * - If Step 6 doesn't match but Step 9 does → PARTIAL (flag for review)
 * - If neither matches OneMap → MISMATCH
 */
export function validateSerialCrossReference(data: DrValidationData): SerialValidationResult {
  const onemapSerial = data.ontSerial?.trim().toUpperCase() || null;
  const step6Serial = data.vlmOntSerialStep6?.trim().toUpperCase() || null;
  const step9Serial = data.vlmOntSerialStep9?.trim().toUpperCase() || null;
  const step9DrNumber = data.vlmDrNumberStep9?.trim() || null;

  // Check if any VLM extractions are pending
  if (!step6Serial && !step9Serial) {
    return {
      status: 'pending',
      onemapSerial,
      step6Serial,
      step9Serial,
      step9DrNumber,
      expectedDrNumber: data.drNumber,
      ontMatch: false,
      drMatch: false,
      details: 'VLM serial extraction not yet completed',
    };
  }

  // Use fuzzy matching for serial comparisons
  const step6FuzzyMatch = fuzzySerialMatch(step6Serial, onemapSerial);
  const step9FuzzyMatch = fuzzySerialMatch(step9Serial, onemapSerial);
  const step6vs9FuzzyMatch = fuzzySerialMatch(step6Serial, step9Serial);

  // Legacy exact match checks (for backwards compatibility in logs)
  const step6MatchesOnemap = step6FuzzyMatch.isMatch;
  const step9MatchesOnemap = step9FuzzyMatch.isMatch;
  const step6MatchesStep9 = step6vs9FuzzyMatch.isMatch;

  // Check DR number match
  const drMatch =
    !step9DrNumber ||
    step9DrNumber.toUpperCase().includes(data.drNumber.toUpperCase()) ||
    data.drNumber.toUpperCase().includes(step9DrNumber.toUpperCase());

  // Determine ONT match status - Step 6 is authoritative
  let ontMatch = false;
  let status: SerialValidationResult['status'];
  let details: string;

  if (step6MatchesOnemap) {
    // Step 6 matches OneMap (exact or fuzzy) - this is the gold standard
    ontMatch = true;

    // Build match type description
    const matchType = step6FuzzyMatch.isExactMatch ? 'exact' : 'fuzzy';
    const matchNote = step6FuzzyMatch.isFuzzyMatch
      ? ` (${step6FuzzyMatch.distance} char diff, ${(step6FuzzyMatch.confidence * 100).toFixed(0)}% confidence)`
      : '';

    if (step6MatchesStep9) {
      // Perfect: all three match
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `All serial and DR number checks passed (${matchType} match${matchNote})`
        : `DR number mismatch: Expected ${data.drNumber}, Got ${step9DrNumber}`;
    } else if (step9Serial) {
      // Step 6 matches but Step 9 differs - log warning but pass serial check
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `Serial verified via Step 6 (${matchType} match${matchNote}). Note: Step 9 shows different value (${step9Serial})`
        : `DR number mismatch. Serial verified via Step 6.`;

      if (!step6FuzzyMatch.isExactMatch) {
        log.info('QaAutoFail', `Fuzzy match accepted for ${data.drNumber}`, {
          onemapSerial,
          step6Serial,
          distance: step6FuzzyMatch.distance,
          confidence: step6FuzzyMatch.confidence,
        });
      }
    } else {
      // Step 6 matches but no Step 9 - still valid
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `Serial verified via Step 6 (${matchType} match${matchNote})`
        : `DR number mismatch. Serial verified via Step 6.`;
    }
  } else if (step9MatchesOnemap) {
    // Step 6 doesn't match but Step 9 does - flag for manual review
    ontMatch = false;
    status = 'partial';

    const matchType = step9FuzzyMatch.isExactMatch ? 'exact' : 'fuzzy';
    const matchNote = step9FuzzyMatch.isFuzzyMatch
      ? ` (${step9FuzzyMatch.distance} char diff)`
      : '';

    details = `Step 6 serial (${step6Serial || 'N/A'}) doesn't match OneMap (${onemapSerial}), but Step 9 does (${matchType}${matchNote}). Needs review.`;
  } else if (!onemapSerial && (step6Serial || step9Serial)) {
    // No OneMap serial to compare - can't validate
    ontMatch = false;
    status = 'pending';
    details = 'No OneMap serial available for comparison';
  } else {
    // Neither Step 6 nor Step 9 matches OneMap - definite mismatch
    // But log the closest match for debugging
    ontMatch = false;
    status = 'mismatch';

    const closestMatch = step6FuzzyMatch.confidence > step9FuzzyMatch.confidence
      ? { source: 'Step6', serial: step6Serial, result: step6FuzzyMatch }
      : { source: 'Step9', serial: step9Serial, result: step9FuzzyMatch };

    let debugInfo = '';
    if (closestMatch.result.distance > 0 && closestMatch.result.distance <= 5) {
      debugInfo = ` [Closest: ${closestMatch.source}=${closestMatch.serial}, ${closestMatch.result.distance} chars diff]`;
    }

    details = `ONT serials don't match OneMap: OneMap=${onemapSerial}, Step6=${step6Serial || 'N/A'}, Step9=${step9Serial || 'N/A'}${debugInfo}`;

    log.warn('QaAutoFail', `Serial mismatch for ${data.drNumber}`, {
      onemapSerial,
      step6Serial,
      step9Serial,
      step6Distance: step6FuzzyMatch.distance,
      step9Distance: step9FuzzyMatch.distance,
      step6Confidence: step6FuzzyMatch.confidence,
      step9Confidence: step9FuzzyMatch.confidence,
    });
  }

  return {
    status,
    onemapSerial,
    step6Serial,
    step9Serial,
    step9DrNumber,
    expectedDrNumber: data.drNumber,
    ontMatch,
    drMatch,
    details,
  };
}

/**
 * Evaluate auto-fail and generate recommendation
 */
export function evaluateAutoFail(data: DrValidationData): AutoFailResult {
  const reasons: FailReasonCode[] = [];

  // Check prerequisites
  const prereqs = checkPrerequisites(data);
  reasons.push(...prereqs.failures);

  // Check step coverage
  const coverage = checkStepCoverage(data.photos);
  if (!coverage.complete) {
    reasons.push('MISSING_PHOTOS');
  }

  // Check power meter
  const powerResult = validatePowerMeter(data.powerMeterDbm);
  if (powerResult.status === 'fail_high' || powerResult.status === 'fail_low') {
    reasons.push('POWER_OUT_OF_RANGE');
  }

  // Check serial cross-reference
  const serialResult = validateSerialCrossReference(data);
  if (serialResult.status === 'mismatch') {
    if (!serialResult.ontMatch) {
      reasons.push('SERIAL_MISMATCH');
    }
    if (!serialResult.drMatch) {
      reasons.push('DR_NUMBER_MISMATCH');
    }
  }

  // Check for discarded critical steps
  const discardedSteps = data.photos.filter((p) => p.step === 0);
  if (discardedSteps.length > 0 && !coverage.complete) {
    // If steps are missing AND some photos are discarded, flag it
    reasons.push('DISCARDED_CRITICAL');
  }

  // Remove duplicates
  const uniqueReasons = [...new Set(reasons)];

  // Determine recommendation
  let recommendation: 'PASS' | 'FAIL' | 'REWORK_NEEDED';
  let summary: string;

  if (uniqueReasons.length === 0) {
    recommendation = 'PASS';
    summary = 'All checks passed - ready for approval';
  } else if (
    uniqueReasons.includes('MISSING_PHOTOS') ||
    uniqueReasons.includes('MISSING_SERIAL') ||
    uniqueReasons.includes('DR_NUMBER_MISMATCH')
  ) {
    recommendation = 'FAIL';
    summary = `Critical failures: ${uniqueReasons.join(', ')}`;
  } else {
    recommendation = 'REWORK_NEEDED';
    summary = `Issues requiring review: ${uniqueReasons.join(', ')}`;
  }

  return {
    autoFail: recommendation === 'FAIL',
    reasons: uniqueReasons,
    recommendation,
    summary,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get human-readable description for fail reason code
 */
export function getFailReasonDescription(code: FailReasonCode): string {
  const descriptions: Record<FailReasonCode, string> = {
    MISSING_PHOTOS: 'One or more required installation steps have no photos',
    MISSING_SERIAL: 'ONT or UPS serial number not synced from OneMap',
    SERIAL_MISMATCH: '3-way ONT serial check failed (Step 6 vs Step 9 vs OneMap)',
    DR_NUMBER_MISMATCH: 'DR number on front label does not match current DR',
    POWER_OUT_OF_RANGE: 'Power meter reading outside valid range (-18 to -24 dBm)',
    DISCARDED_CRITICAL: 'Required step photo was discarded as rubbish',
  };

  return descriptions[code] || code;
}

/**
 * Format step coverage for display
 */
export function formatStepCoverage(result: StepCoverageResult): string {
  const progressBar = REQUIRED_STEPS.map((step) =>
    result.covered.includes(step) ? '■' : '□'
  ).join('');

  return `${result.covered.length}/${result.total} ${progressBar}`;
}

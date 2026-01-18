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
 * Fail reason codes for tracking
 */
export type FailReasonCode =
  | 'MISSING_PHOTOS'
  | 'MISSING_SERIAL'
  | 'SERIAL_MISMATCH'
  | 'DR_NUMBER_MISMATCH'
  | 'POWER_OUT_OF_RANGE'
  | 'DISCARDED_CRITICAL';

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
 * ONT Serial regex pattern
 * Matches: ALCLB463EE35, ALCB480FE3D
 */
const ONT_SERIAL_PATTERN = /^ALCL?B?[A-Z0-9]{7,9}$/i;

/**
 * Power meter valid range (dBm)
 * - Above -18: FAIL (too high)
 * - Between -18 and -24: PASS
 * - Below -24: FAIL (too low)
 */
const POWER_METER_MIN = -24;
const POWER_METER_MAX = -18;

/**
 * UPS Serial length range
 */
const UPS_SERIAL_MIN_LENGTH = 8;
const UPS_SERIAL_MAX_LENGTH = 12;

/**
 * Required steps (all 10 must be present)
 */
const REQUIRED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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
 * Validate 3-way serial cross-reference
 */
export function validateSerialCrossReference(data: DrValidationData): SerialValidationResult {
  const onemapSerial = data.ontSerial?.trim() || null;
  const step6Serial = data.vlmOntSerialStep6?.trim() || null;
  const step9Serial = data.vlmOntSerialStep9?.trim() || null;
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

  // Check ONT serial match (3-way)
  const serialsToCompare = [onemapSerial, step6Serial, step9Serial].filter(Boolean);
  const uniqueSerials = [...new Set(serialsToCompare.map((s) => s?.toUpperCase()))];
  const ontMatch = uniqueSerials.length <= 1 && serialsToCompare.length > 0;

  // Check DR number match
  const drMatch =
    !step9DrNumber ||
    step9DrNumber.toUpperCase().includes(data.drNumber.toUpperCase()) ||
    data.drNumber.toUpperCase().includes(step9DrNumber.toUpperCase());

  // Determine status
  let status: SerialValidationResult['status'];
  let details: string;

  if (ontMatch && drMatch) {
    status = 'match';
    details = 'All serial and DR number checks passed';
  } else if (!ontMatch && !drMatch) {
    status = 'mismatch';
    details = `ONT serials don't match (${uniqueSerials.join(' vs ')}) AND DR number mismatch`;
  } else if (!ontMatch) {
    status = 'mismatch';
    details = `ONT serials don't match: OneMap=${onemapSerial}, Step6=${step6Serial}, Step9=${step9Serial}`;
  } else if (!drMatch) {
    status = 'mismatch';
    details = `DR number mismatch: Expected ${data.drNumber}, Got ${step9DrNumber}`;
  } else {
    status = 'partial';
    details = 'Partial match - some checks pending';
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

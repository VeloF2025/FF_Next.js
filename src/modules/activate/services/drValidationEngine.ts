/**
 * DR Validation Engine
 *
 * Purpose: Run prerequisite checks, step-coverage analysis, serial
 * cross-reference (3-way with fuzzy matching), and power meter validation
 * for a DR submission.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import {
  FailReasonCode,
  PrerequisitesResult,
  StepCoverageResult,
  PowerMeterResult,
  SerialValidationResult,
  DrValidationData,
} from './autoFailTypes';
import {
  validateOntSerial,
  validateUpsSerial,
  looksLikeOntSerial,
  looksLikeGizzuSerial,
  detectSwappedSerials,
  fuzzySerialMatch,
} from './serialValidator';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Power meter valid range (dBm).
 * - Above -18: FAIL (too high)
 * - Between -18 and -24: PASS
 * - Below -24: FAIL (too low)
 */
const POWER_METER_MIN = -24;
const POWER_METER_MAX = -18;

/** Required steps (all 10 must be present) */
const REQUIRED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ============================================================================
// POWER METER
// ============================================================================

/**
 * Validate power meter reading against the acceptable dBm range.
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
// PREREQUISITES
// ============================================================================

/**
 * Check prerequisites before starting detailed review.
 *
 * Auto-fail conditions:
 * - No photos
 * - Missing ONT serial (from OneMap)
 * - Missing UPS serial (from OneMap)
 */
export function checkPrerequisites(
  data: DrValidationData
): PrerequisitesResult {
  log.debug(
    `Checking prerequisites for ${data.drNumber}`,
    undefined,
    'QaAutoFail'
  );

  const failures: FailReasonCode[] = [];

  const photosAvailable = data.photoCount > 0;
  if (!photosAvailable) {
    failures.push('MISSING_PHOTOS');
  }

  const ontSerialPresent = !!data.ontSerial;
  const ontValidation = validateOntSerial(data.ontSerial);

  if (!ontSerialPresent) {
    failures.push('MISSING_SERIAL');
  }

  const upsSerialPresent = !!data.upsSerial;
  const upsValidation = validateUpsSerial(data.upsSerial);

  if (!upsSerialPresent) {
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

  log.info(
    `Prerequisites ${passed ? 'PASSED' : 'FAILED'} for ${data.drNumber}`,
    { failures, photoCount: data.photoCount },
    'QaAutoFail'
  );

  return result;
}

// ============================================================================
// STEP COVERAGE
// ============================================================================

/**
 * Check step coverage from categorized photos.
 */
export function checkStepCoverage(
  photos: Array<{ filename: string; step: number | null }>
): StepCoverageResult {
  const coverageMap: Record<number, string[]> = {};

  for (let step = 1; step <= 10; step++) {
    coverageMap[step] = [];
  }

  for (const photo of photos) {
    if (photo.step !== null && photo.step >= 1 && photo.step <= 10) {
      const stepArray = coverageMap[photo.step];
      if (stepArray) {
        stepArray.push(photo.filename);
      }
    }
  }

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

// ============================================================================
// SERIAL CROSS-REFERENCE
// ============================================================================

/**
 * Validate 3-way serial cross-reference with FUZZY MATCHING.
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
export function validateSerialCrossReference(
  data: DrValidationData
): SerialValidationResult {
  const onemapSerial = data.ontSerial?.trim().toUpperCase() || null;
  const step6Serial = data.vlmOntSerialStep6?.trim().toUpperCase() || null;
  const step9Serial = data.vlmOntSerialStep9?.trim().toUpperCase() || null;
  const step9DrNumber = data.vlmDrNumberStep9?.trim() || null;

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

  const step6FuzzyMatch = fuzzySerialMatch(step6Serial, onemapSerial);
  const step9FuzzyMatch = fuzzySerialMatch(step9Serial, onemapSerial);
  const step6vs9FuzzyMatch = fuzzySerialMatch(step6Serial, step9Serial);

  const step6MatchesOnemap = step6FuzzyMatch.isMatch;
  const step9MatchesOnemap = step9FuzzyMatch.isMatch;
  const step6MatchesStep9 = step6vs9FuzzyMatch.isMatch;

  const drMatch =
    !step9DrNumber ||
    step9DrNumber.toUpperCase().includes(data.drNumber.toUpperCase()) ||
    data.drNumber.toUpperCase().includes(step9DrNumber.toUpperCase());

  let ontMatch = false;
  let status: SerialValidationResult['status'];
  let details: string;

  if (step6MatchesOnemap) {
    ontMatch = true;
    const matchType = step6FuzzyMatch.isExactMatch ? 'exact' : 'fuzzy';
    const matchNote = step6FuzzyMatch.isFuzzyMatch
      ? ` (${step6FuzzyMatch.distance} char diff, ${(step6FuzzyMatch.confidence * 100).toFixed(0)}% confidence)`
      : '';

    if (step6MatchesStep9) {
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `All serial and DR number checks passed (${matchType} match${matchNote})`
        : `DR number mismatch: Expected ${data.drNumber}, Got ${step9DrNumber}`;
    } else if (step9Serial) {
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `Serial verified via Step 6 (${matchType} match${matchNote}). Note: Step 9 shows different value (${step9Serial})`
        : `DR number mismatch. Serial verified via Step 6.`;

      if (!step6FuzzyMatch.isExactMatch) {
        log.info(
          `Fuzzy match accepted for ${data.drNumber}`,
          {
            onemapSerial,
            step6Serial,
            distance: step6FuzzyMatch.distance,
            confidence: step6FuzzyMatch.confidence,
          },
          'QaAutoFail'
        );
      }
    } else {
      status = drMatch ? 'match' : 'mismatch';
      details = drMatch
        ? `Serial verified via Step 6 (${matchType} match${matchNote})`
        : `DR number mismatch. Serial verified via Step 6.`;
    }
  } else if (step9MatchesOnemap) {
    ontMatch = false;
    status = 'partial';
    const matchType = step9FuzzyMatch.isExactMatch ? 'exact' : 'fuzzy';
    const matchNote = step9FuzzyMatch.isFuzzyMatch
      ? ` (${step9FuzzyMatch.distance} char diff)`
      : '';
    details = `Step 6 serial (${step6Serial || 'N/A'}) doesn't match OneMap (${onemapSerial}), but Step 9 does (${matchType}${matchNote}). Needs review.`;
  } else if (!onemapSerial && (step6Serial || step9Serial)) {
    ontMatch = false;
    status = 'pending';
    details = 'No OneMap serial available for comparison';
  } else {
    ontMatch = false;
    status = 'mismatch';

    const closestMatch =
      step6FuzzyMatch.confidence > step9FuzzyMatch.confidence
        ? { source: 'Step6', serial: step6Serial, result: step6FuzzyMatch }
        : { source: 'Step9', serial: step9Serial, result: step9FuzzyMatch };

    let debugInfo = '';
    if (
      closestMatch.result.distance > 0 &&
      closestMatch.result.distance <= 5
    ) {
      debugInfo = ` [Closest: ${closestMatch.source}=${closestMatch.serial}, ${closestMatch.result.distance} chars diff]`;
    }

    details = `ONT serials don't match OneMap: OneMap=${onemapSerial}, Step6=${step6Serial || 'N/A'}, Step9=${step9Serial || 'N/A'}${debugInfo}`;

    log.warn(
      `Serial mismatch for ${data.drNumber}`,
      {
        onemapSerial,
        step6Serial,
        step9Serial,
        step6Distance: step6FuzzyMatch.distance,
        step9Distance: step9FuzzyMatch.distance,
        step6Confidence: step6FuzzyMatch.confidence,
        step9Confidence: step9FuzzyMatch.confidence,
      },
      'QaAutoFail'
    );
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

// Technician issue helpers live in autoFailEvaluation.ts to keep this file
// within the 400-line limit. They are re-exported from qaAutoFailService.ts.

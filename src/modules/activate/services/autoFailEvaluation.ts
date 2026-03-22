/**
 * Auto-Fail Evaluation
 *
 * Purpose: Top-level auto-fail decision logic — aggregates checks from
 * drValidationEngine into a final PASS / FAIL / REWORK_NEEDED recommendation.
 * Also provides helper descriptions and formatting functions.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import {
  FailReasonCode,
  TechnicianIssue,
  TechnicianIssueCode,
  StepCoverageResult,
  AutoFailResult,
  DrValidationData,
} from './autoFailTypes';
import {
  checkPrerequisites,
  checkStepCoverage,
  validateSerialCrossReference,
  validatePowerMeter,
} from './drValidationEngine';
import { looksLikeOntSerial, looksLikeGizzuSerial } from './serialValidator';

// ============================================================================
// EVALUATION
// ============================================================================

/**
 * Evaluate auto-fail and generate a recommendation for a DR submission.
 *
 * Runs all checks in sequence:
 * 1. Prerequisites (photos, serials present)
 * 2. Step coverage (all 10 steps photographed)
 * 3. Power meter range
 * 4. Serial cross-reference (3-way with fuzzy matching)
 * 5. Discarded critical steps
 *
 * @param data - DR validation data
 * @returns Auto-fail result with recommendation
 */
export function evaluateAutoFail(data: DrValidationData): AutoFailResult {
  const reasons: FailReasonCode[] = [];

  // Prerequisites
  const prereqs = checkPrerequisites(data);
  reasons.push(...prereqs.failures);

  // Step coverage
  const coverage = checkStepCoverage(data.photos);
  if (!coverage.complete) {
    reasons.push('MISSING_PHOTOS');
  }

  // Power meter
  const powerResult = validatePowerMeter(data.powerMeterDbm);
  if (
    powerResult.status === 'fail_high' ||
    powerResult.status === 'fail_low'
  ) {
    reasons.push('POWER_OUT_OF_RANGE');
  }

  // Serial cross-reference
  const serialResult = validateSerialCrossReference(data);
  if (serialResult.status === 'mismatch') {
    if (!serialResult.ontMatch) {
      reasons.push('SERIAL_MISMATCH');
    }
    if (!serialResult.drMatch) {
      reasons.push('DR_NUMBER_MISMATCH');
    }
  }

  // Discarded critical steps
  const discardedSteps = data.photos.filter((p) => p.step === 0);
  if (discardedSteps.length > 0 && !coverage.complete) {
    reasons.push('DISCARDED_CRITICAL');
  }

  const uniqueReasons = [...new Set(reasons)];

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
// HELPER DESCRIPTIONS
// ============================================================================

/**
 * Get human-readable description for a fail reason code.
 */
export function getFailReasonDescription(code: FailReasonCode): string {
  const descriptions: Record<FailReasonCode, string> = {
    MISSING_PHOTOS:
      'One or more required installation steps have no photos',
    MISSING_SERIAL:
      'ONT or UPS serial number not synced from OneMap',
    SERIAL_MISMATCH:
      '3-way ONT serial check failed (Step 6 vs Step 9 vs OneMap)',
    DR_NUMBER_MISMATCH:
      'DR number on front label does not match current DR',
    POWER_OUT_OF_RANGE:
      'Power meter reading outside valid range (-18 to -24 dBm)',
    DISCARDED_CRITICAL:
      'Required step photo was discarded as rubbish',
  };

  return descriptions[code] || code;
}

/**
 * Format step coverage for display.
 * Example output: "8/10 ■■■■■■■■□□"
 */
export function formatStepCoverage(result: StepCoverageResult): string {
  const REQUIRED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const progressBar = REQUIRED_STEPS.map((step) =>
    result.covered.includes(step) ? '■' : '□'
  ).join('');

  return `${result.covered.length}/${result.total} ${progressBar}`;
}

// ============================================================================
// TECHNICIAN ISSUES
// ============================================================================

/** Input shape for getTechnicianIssues. */
interface TechnicianIssuesInput {
  ontSerial: string | null;
  upsSerial: string | null;
  photoCount: number;
  missingSteps: number[];
  powerMeterDbm: number | null;
}

/**
 * Build the list of technician-actionable issues from QA check results.
 *
 * Unlike the internal FailReasonCode list (used for auto-fail scoring), these
 * codes are shown directly to the technician in WhatsApp feedback and in the
 * QA wizard UI — only include things the technician can actually fix.
 *
 * @param input - Extracted QA data
 * @returns Array of TechnicianIssue objects (may be empty)
 */
export function getTechnicianIssues(
  input: TechnicianIssuesInput
): TechnicianIssue[] {
  const issues: TechnicianIssue[] = [];
  const { ontSerial, upsSerial, photoCount, missingSteps, powerMeterDbm } =
    input;

  // --- Swapped serials (critical — shown before anything else) ---
  const ontLooksLikeGizzu = looksLikeGizzuSerial(ontSerial);
  const upsLooksLikeOnt = looksLikeOntSerial(upsSerial);

  if (ontLooksLikeGizzu || upsLooksLikeOnt) {
    issues.push({
      code: 'SERIALS_SWAPPED',
      message: 'ONT and UPS serials appear to be in the wrong fields in 1Map',
      severity: 'error',
    });
  }

  // --- Missing / invalid ONT serial ---
  if (!ontSerial) {
    issues.push({
      code: 'ONT_NOT_SCANNED',
      message: 'ONT serial not scanned in 1Map',
      severity: 'error',
    });
  } else if (!looksLikeOntSerial(ontSerial) && !ontLooksLikeGizzu) {
    issues.push({
      code: 'ONT_INVALID_FORMAT',
      message: `ONT serial format invalid: ${ontSerial}`,
      severity: 'warning',
    });
  }

  // --- Missing / invalid UPS serial ---
  if (!upsSerial) {
    issues.push({
      code: 'UPS_NOT_SCANNED',
      message: 'UPS serial not scanned in 1Map',
      severity: 'error',
    });
  } else if (!looksLikeGizzuSerial(upsSerial) && !upsLooksLikeOnt) {
    issues.push({
      code: 'UPS_INVALID_FORMAT',
      message: `UPS serial format invalid: ${upsSerial}`,
      severity: 'warning',
    });
  }

  // --- Missing step photos ---
  if (photoCount === 0 || missingSteps.length > 0) {
    issues.push({
      code: 'MISSING_PHOTOS',
      message:
        missingSteps.length > 0
          ? `Missing photos for steps: ${missingSteps.join(', ')}`
          : 'No installation photos found',
      severity: 'error',
    });
  }

  // --- Power meter out of range ---
  const POWER_METER_MIN = -24;
  const POWER_METER_MAX = -18;
  if (
    powerMeterDbm !== null &&
    (powerMeterDbm > POWER_METER_MAX || powerMeterDbm < POWER_METER_MIN)
  ) {
    issues.push({
      code: 'POWER_OUT_OF_RANGE',
      message: `Power meter ${powerMeterDbm} dBm is outside the valid range (${POWER_METER_MAX} to ${POWER_METER_MIN} dBm)`,
      severity: 'warning',
    });
  }

  return issues;
}

/**
 * Get a short human-readable description for a TechnicianIssueCode.
 * Used when rendering issues in the wizard and WhatsApp messages.
 */
export function getTechnicianIssueDescription(
  code: TechnicianIssueCode
): string {
  const descriptions: Record<TechnicianIssueCode, string> = {
    ONT_NOT_SCANNED: 'Scan the ONT barcode in 1Map (S/N on back of device)',
    UPS_NOT_SCANNED: 'Scan the UPS/Gizzu barcode in 1Map',
    SERIALS_SWAPPED: 'Serials are in the wrong fields — swap ONT and UPS in 1Map',
    ONT_INVALID_FORMAT: 'ONT serial format is invalid — re-scan in 1Map',
    UPS_INVALID_FORMAT: 'UPS serial format is invalid — re-scan in 1Map',
    MISSING_PHOTOS: 'Upload missing step photos in 1Map',
    POWER_OUT_OF_RANGE: 'Re-test power meter — reading is outside acceptable range',
  };

  return descriptions[code] || code;
}

/**
 * Auto-QA Comment Generator
 *
 * Generates per-photo comments and overall feedback messages
 * for automated QA processing. Comments are technician-facing
 * and written in clear, actionable language.
 */

import { STEP_LABELS } from '../utils/stepMapper';
import {
  type AutoFailResult,
  type PowerMeterResult,
  type StepCoverageResult,
  type SerialValidationResult,
  type PrerequisitesResult,
  formatSerialFeedback,
  detectSwappedSerials,
  getTechnicianIssues,
  getTechnicianIssueDescription,
} from './qaAutoFailService';
import type { AutoApprovalTier } from './autoApprovalService';
import type { QaDecision } from '../types/unified.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AutoQaPhotoResult {
  filename: string;
  step: number;
  stepLabel: string;
  tier: AutoApprovalTier;
  decision: 'PASS' | 'FAIL';
  comment: string;
  confidence: number;
}

export interface AutoQaValidations {
  prerequisites: PrerequisitesResult;
  stepCoverage: StepCoverageResult;
  powerMeter: PowerMeterResult;
  serialValidation: SerialValidationResult;
  autoFail: AutoFailResult;
}

export interface AutoQaResults {
  summary: {
    total: number;
    passed: number;
    failed: number;
    decision: QaDecision;
  };
  photos: AutoQaPhotoResult[];
  validations: AutoQaValidations;
  feedbackMessage: string;
}

// ============================================================================
// PER-PHOTO COMMENT GENERATION
// ============================================================================

/**
 * Generate a technician-facing comment for a single photo
 */
export function generatePhotoComment(
  step: number,
  tier: AutoApprovalTier,
  confidence: number,
  decision: 'PASS' | 'FAIL',
  vlmReasoning: string
): string {
  const stepLabel = STEP_LABELS[step] || `Step ${step}`;

  // Duplicate photo — always FAIL
  if (step === -1) {
    return 'Duplicate Photo: This photo is a duplicate of another photo in this submission';
  }

  if (decision === 'PASS') {
    if (tier === 'auto_approved') {
      return `${stepLabel}: Verified (${Math.round(confidence * 100)}% confidence)`;
    }
    return `${stepLabel}: Accepted after review (${Math.round(confidence * 100)}% confidence)`;
  }

  // FAIL cases - provide actionable feedback
  if (step === 0) {
    return 'Photo not recognised as an installation step - please retake or replace';
  }

  return `${stepLabel}: Photo did not pass QA check - ${vlmReasoning || 'please retake this photo'}`;
}

/**
 * Generate comment for a missing step (no photo at all)
 */
export function generateMissingStepComment(step: number): string {
  const stepLabel = STEP_LABELS[step] || `Step ${step}`;
  return `${stepLabel}: Photo missing - please upload this step`;
}

// ============================================================================
// FEEDBACK MESSAGE GENERATION
// ============================================================================

/**
 * Generate the full WhatsApp feedback message for a DR
 */
export function generateFeedbackMessage(
  dropNumber: string,
  decision: QaDecision,
  photoResults: AutoQaPhotoResult[],
  validations: AutoQaValidations
): string {
  const lines: string[] = [];

  // Header
  if (decision === 'PASS') {
    lines.push(`*${dropNumber} - APPROVED* ✅`);
  } else if (decision === 'FAIL') {
    lines.push(`*${dropNumber} - FAILED* ❌`);
  } else {
    lines.push(`*${dropNumber} - REWORK NEEDED* ⚠️`);
  }
  lines.push('');
  lines.push('_Auto-QA Review_');
  lines.push('');

  // Swapped serials warning
  const swapCheck = detectSwappedSerials(
    validations.prerequisites.details.ontSerial,
    validations.prerequisites.details.upsSerial
  );
  if (swapCheck.swapped) {
    lines.push('🔴 *CRITICAL: SERIALS SWAPPED*');
    lines.push(swapCheck.details);
    lines.push('Please correct in 1Map immediately.');
    lines.push('');
  }

  // Photo coverage
  const { covered, missing } = validations.stepCoverage;
  lines.push(`*Photo Coverage:* ${covered.length}/10 steps`);
  if (missing.length > 0) {
    const missingLabels = missing
      .map((s) => STEP_LABELS[s] || `Step ${s}`)
      .join(', ');
    lines.push(`*Missing Photos:* ${missingLabels}`);
  }
  lines.push('');

  // Validation results
  lines.push('*Validation Results:*');

  const pm = validations.powerMeter;
  if (pm.value !== null) {
    const pmStatus = pm.inRange ? '✓' : '✗';
    lines.push(`- Power Meter: ${pm.value} dBm ${pmStatus}`);
  }

  const serialFeedback = formatSerialFeedback(
    validations.prerequisites.details.ontSerial,
    validations.prerequisites.details.upsSerial
  );
  lines.push(serialFeedback.ontLine);
  lines.push(serialFeedback.upsLine);
  lines.push('');

  // Technician-actionable issues
  const techIssues = getTechnicianIssues({
    ontSerial: validations.prerequisites.details.ontSerial,
    upsSerial: validations.prerequisites.details.upsSerial,
    photoCount: validations.prerequisites.details.photoCount,
    missingSteps: missing,
    powerMeterDbm: pm.value,
  });

  const actionableIssues = techIssues.filter((i) => i.code !== 'SERIALS_SWAPPED');
  if (actionableIssues.length > 0) {
    lines.push('*Action Required:*');
    actionableIssues.forEach((issue) => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      lines.push(`${icon} ${getTechnicianIssueDescription(issue.code)}`);
    });
    lines.push('');
  }

  // Duplicate photos
  const duplicatePhotos = photoResults.filter((p) => p.step === -1);
  if (duplicatePhotos.length > 0) {
    lines.push(`*Duplicate Photos:* ${duplicatePhotos.length} photo(s) flagged as duplicates`);
    lines.push('');
  }

  // Failed photos detail (include duplicates and discards in issues list)
  const failedPhotos = photoResults.filter((p) => p.decision === 'FAIL' && (p.step > 0 || p.step === -1));
  if (failedPhotos.length > 0) {
    lines.push('*Photo Issues:*');
    failedPhotos.forEach((p) => {
      // Always prefix with step label so the technician knows which photo is affected,
      // even if the human editor wrote a custom comment without the step name.
      const label = STEP_LABELS[p.step] || `Step ${p.step}`;
      const alreadyPrefixed = p.comment.startsWith(`${label}:`);
      const line = alreadyPrefixed ? p.comment : `${label}: ${p.comment}`;
      lines.push(`- ${line}`);
    });
    lines.push('');
  }

  // Final prompt
  if (decision === 'FAIL' || decision === 'REWORK_NEEDED') {
    if (actionableIssues.length > 0 || swapCheck.swapped || failedPhotos.length > 0) {
      lines.push('Please address the issues above and resubmit.');
    }
  }

  return lines.join('\n');
}

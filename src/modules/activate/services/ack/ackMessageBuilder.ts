/**
 * ACK Message Builder
 *
 * Builds WhatsApp acknowledgment messages for DR submissions.
 * Pure functions — no side effects, no DB calls.
 *
 * Three message types:
 * - generateAckMessage: normal first submission
 * - generateResubmissionAckMessage: re-submission after QA
 * - generateNotOnOneMapMessage: DR in drops table but missing from 1Map
 */

import {
  detectSwappedSerials,
  looksLikeGizzuSerial,
  looksLikeOntSerial,
} from '@/modules/activate/services/qaAutoFailService';

import type { AckResult, DropsTableRecord, DuplicateSerialResult, VlmSerialResult, WAPhotoCheck } from './types';

/**
 * Normalize serial for case-insensitive comparison.
 */
export function normalizeForCompare(serial: string): string {
  return serial.trim().toUpperCase();
}

/**
 * Build serial warning lines for ack messages.
 *
 * Shared by generateAckMessage() and generateResubmissionAckMessage().
 * Uses per-serial confidence when available to avoid barcode ONT confidence
 * inflating UPS VLM trust.
 */
function buildSerialWarningLines(
  ontSerial: string | null,
  upsSerial: string | null,
  vlmResult: VlmSerialResult | undefined,
  duplicates: DuplicateSerialResult
): string[] {
  const lines: string[] = [];

  const MIN_VLM_CONFIDENCE = 0.95;
  const ontConfidence = vlmResult?.ontConfidence ?? vlmResult?.confidence ?? 0;
  const upsConfidence = vlmResult?.upsConfidence ?? vlmResult?.confidence ?? 0;
  const trustOntVlm = vlmResult && ontConfidence >= MIN_VLM_CONFIDENCE;
  const trustUpsVlm = vlmResult && upsConfidence >= MIN_VLM_CONFIDENCE;

  // --- ONT Serial ---
  if (ontSerial) {
    if (trustOntVlm && vlmResult?.ontSerial && normalizeForCompare(ontSerial) !== normalizeForCompare(vlmResult.ontSerial)) {
      lines.push(`🟡 *ONT Serial MISMATCH:*`);
      lines.push(`   1Map: ${ontSerial}`);
      lines.push(`   Sticker: ${vlmResult.ontSerial}`);
      lines.push(`   ⚠️ *Please double-check in 1Map*`);
    } else if (trustOntVlm && vlmResult?.ontSerial) {
      lines.push(`🔌 ONT Serial: ${ontSerial} ✅`);
    } else {
      lines.push(`🔌 ONT Serial: ${ontSerial}`);
      lines.push(`   📷 Please double-check ONT serial`);
    }
  } else {
    lines.push(`🔴 *ONT Serial: NOT SCANNED*`);
    lines.push(`   ⚠️ *Please scan ONT barcode in 1Map!*`);
    if (trustOntVlm && vlmResult?.ontSerial) {
      lines.push(`   📷 Photo shows: ${vlmResult.ontSerial}`);
    }
  }

  // ONT duplicate warning
  if (duplicates.ontDuplicates.length > 0) {
    const drList = duplicates.ontDuplicates.map(d => d.drop_number).join(', ');
    lines.push(`🔴 *ONT Serial ${ontSerial} already used on ${drList}!*`);
    lines.push(`   ⚠️ *Please verify this is the correct serial*`);
  }

  // --- UPS Serial ---
  if (upsSerial) {
    if (trustUpsVlm && vlmResult?.upsSerial && normalizeForCompare(upsSerial) !== normalizeForCompare(vlmResult.upsSerial)) {
      lines.push(`🟡 *UPS Serial MISMATCH:*`);
      lines.push(`   1Map: ${upsSerial}`);
      lines.push(`   Sticker: ${vlmResult.upsSerial}`);
      lines.push(`   ⚠️ *Please double-check in 1Map*`);
    } else if (trustUpsVlm && vlmResult?.upsSerial) {
      lines.push(`🔋 UPS Serial: ${upsSerial} ✅`);
    } else {
      lines.push(`🔋 UPS Serial: ${upsSerial}`);
      lines.push(`   📷 Please double-check UPS serial`);
    }
  } else {
    lines.push(`🔴 *UPS Serial: NOT SCANNED*`);
    lines.push(`   ⚠️ *Please scan UPS barcode in 1Map!*`);
    if (trustUpsVlm && vlmResult?.upsSerial) {
      lines.push(`   📷 Photo shows: ${vlmResult.upsSerial}`);
    }
  }

  // UPS duplicate warning
  if (duplicates.upsDuplicates.length > 0) {
    const drList = duplicates.upsDuplicates.map(d => d.drop_number).join(', ');
    lines.push(`🔴 *UPS Serial ${upsSerial} already used on ${drList}!*`);
    lines.push(`   ⚠️ *Please verify this is the correct serial*`);
  }

  return lines;
}

/**
 * Generate WhatsApp acknowledgment message for a normal first submission.
 *
 * Returns empty message if DR not found — Go bridge checks for empty and won't send.
 * Detects swapped serials (ONT in UPS field or vice versa) and warns immediately.
 */
export function generateAckMessage(
  dropNumber: string,
  found: boolean,
  photoCount: number,
  ontSerial: string | null,
  upsSerial: string | null,
  waPhotoCheck: WAPhotoCheck = { hasPhoto: false, photoCount: 0 },
  vlmResult?: VlmSerialResult,
  duplicates: DuplicateSerialResult = { ontDuplicates: [], upsDuplicates: [] }
): AckResult {
  if (!found) {
    return { message: '', swapped: false, swapDetails: null };
  }

  const swapCheck = detectSwappedSerials(ontSerial, upsSerial);
  const lines: string[] = [];

  lines.push(`📸 *${dropNumber} Received!*`);
  lines.push('');

  // CRITICAL: Swapped serials warning at the top
  if (swapCheck.swapped) {
    lines.push('🔴 *ALERT: SERIALS APPEAR SWAPPED*');
    lines.push('');
    if (ontSerial && looksLikeGizzuSerial(ontSerial)) {
      lines.push(`❌ ONT field has Gizzu serial: ${ontSerial}`);
    }
    if (upsSerial && looksLikeOntSerial(upsSerial)) {
      lines.push(`❌ UPS field has ONT serial: ${upsSerial}`);
    }
    lines.push('');
    lines.push('*Please correct in 1Map:*');
    lines.push('• ONT should be ALCL/ALCB serial');
    lines.push('• UPS should be GU18W serial (Gizzu)');
    lines.push('');
  }

  // Photo count
  const photoLine =
    photoCount > 0 ? `✅ Photos: ${photoCount}` : `⚠️ Photos: None found - please upload to 1Map`;
  lines.push(photoLine);

  // WA serial photo check
  if (waPhotoCheck.hasPhoto) {
    lines.push(`📷 Serial photo: ✅ Received`);
  } else {
    lines.push('');
    lines.push('⚠️ *No serial photo received*');
    lines.push('Please send ONT & UPS sticker photo with DR');
  }

  // Serial status (with swap consideration, VLM comparison, and duplicate detection)
  if (swapCheck.swapped) {
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
    if (vlmResult && vlmResult.confidence >= 0.95 && (vlmResult.ontSerial || vlmResult.upsSerial)) {
      lines.push('');
      lines.push(`📷 Photo serials: ONT=${vlmResult.ontSerial || '?'} UPS=${vlmResult.upsSerial || '?'}`);
    }
  } else {
    lines.push(...buildSerialWarningLines(ontSerial, upsSerial, vlmResult, duplicates));
  }

  lines.push('');

  if (swapCheck.swapped) {
    lines.push('⚠️ Please correct the swapped serials before QA review.');
  } else {
    lines.push('Thank you! QA review will follow shortly.');
  }

  return {
    message: lines.join('\n'),
    swapped: swapCheck.swapped,
    swapDetails: swapCheck.swapped ? swapCheck.details : null,
  };
}

/**
 * Generate WhatsApp acknowledgment message for a RESUBMISSION.
 *
 * Uses a distinct header and photo count comparison.
 * Marks the DR as needing QA re-review.
 */
export function generateResubmissionAckMessage(
  dropNumber: string,
  newPhotoCount: number,
  previousPhotoCount: number,
  submissionNumber: number,
  ontSerial: string | null,
  upsSerial: string | null,
  vlmResult?: VlmSerialResult,
  duplicates: DuplicateSerialResult = { ontDuplicates: [], upsDuplicates: [] }
): AckResult {
  const swapCheck = detectSwappedSerials(ontSerial, upsSerial);
  const lines: string[] = [];

  lines.push(`🔄 *${dropNumber} Resubmitted!*`);
  lines.push('');
  lines.push(`This is submission #${submissionNumber} for this DR.`);
  lines.push('');

  // CRITICAL: Swapped serials warning
  if (swapCheck.swapped) {
    lines.push('🔴 *ALERT: SERIALS APPEAR SWAPPED*');
    lines.push('');
    if (ontSerial && looksLikeGizzuSerial(ontSerial)) {
      lines.push(`❌ ONT field has Gizzu serial: ${ontSerial}`);
    }
    if (upsSerial && looksLikeOntSerial(upsSerial)) {
      lines.push(`❌ UPS field has ONT serial: ${upsSerial}`);
    }
    lines.push('');
    lines.push('*Please correct in 1Map:*');
    lines.push('• ONT should be ALCL/ALCB serial');
    lines.push('• UPS should be GU18W serial (Gizzu)');
    lines.push('');
  }

  // Photo count comparison
  lines.push(`📸 Photos: ${newPhotoCount} (was ${previousPhotoCount})`);

  if (swapCheck.swapped) {
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
    if (vlmResult && vlmResult.confidence >= 0.95 && (vlmResult.ontSerial || vlmResult.upsSerial)) {
      lines.push('');
      lines.push(`📷 Photo serials: ONT=${vlmResult.ontSerial || '?'} UPS=${vlmResult.upsSerial || '?'}`);
    }
  } else {
    lines.push(...buildSerialWarningLines(ontSerial, upsSerial, vlmResult, duplicates));
  }
  lines.push('');

  lines.push('⚠️ Marked for QA re-review.');
  lines.push('Previous feedback will be considered.');

  return {
    message: lines.join('\n'),
    swapped: swapCheck.swapped,
    swapDetails: swapCheck.swapped ? swapCheck.details : null,
  };
}

/**
 * Generate warning acknowledgment for DRs in drops table but NOT in 1Map.
 *
 * Warns that home sign-up hasn't been completed.
 */
export function generateNotOnOneMapMessage(
  dropNumber: string,
  dropsRecord: DropsTableRecord,
  waPhotoCheck: WAPhotoCheck
): AckResult {
  const lines: string[] = [];

  lines.push(`⚠️ *${dropNumber} Received - NOT ON 1MAP*`);
  lines.push('');
  lines.push('It looks like the home sign-up for this DR has not been completed.');
  lines.push('Please check that first.');
  lines.push('');

  if (dropsRecord.project_name) {
    lines.push(`📍 Project: ${dropsRecord.project_name}`);
  }
  if (dropsRecord.pole_number) {
    lines.push(`📍 Pole: ${dropsRecord.pole_number}`);
  }
  lines.push('');

  if (waPhotoCheck.hasPhoto) {
    lines.push(`📷 Serial photo: ✅ Received`);
  } else {
    lines.push('📷 Serial photo: ❌ Not received');
  }
  lines.push('');

  lines.push('⚠️ This DR will be tracked and checked again once 1Map is updated.');

  return {
    message: lines.join('\n'),
    swapped: false,
    swapDetails: null,
  };
}

/**
 * Serial Feedback
 *
 * Purpose: Human-readable status strings and WhatsApp feedback formatting
 * for ONT and UPS/Gizzu serials. Depends on type-detection helpers from
 * serialValidator.ts but has no logic of its own.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import {
  looksLikeOntSerial,
  looksLikeGizzuSerial,
  maskSerial,
} from './serialValidator';

// ============================================================================
// STATUS + FEEDBACK
// ============================================================================

/**
 * Serial status type for detailed feedback.
 */
export type SerialStatus =
  | 'present_valid'    // Serial is present and matches expected format
  | 'present_swapped'  // Serial is present but appears to be in wrong field
  | 'present_invalid'  // Serial is present but format doesn't match expected
  | 'missing';         // Serial is not present

/**
 * Get detailed serial status for feedback.
 */
export function getSerialStatus(
  serial: string | null,
  expectedType: 'ont' | 'ups'
): { status: SerialStatus; message: string } {
  if (!serial) {
    return {
      status: 'missing',
      message:
        expectedType === 'ont'
          ? '❌ Not scanned in 1Map - please scan ONT barcode'
          : '❌ Not scanned in 1Map - please scan UPS barcode',
    };
  }

  const isOntFormat = looksLikeOntSerial(serial);
  const isGizzuFormat = looksLikeGizzuSerial(serial);
  const masked = maskSerial(serial);

  if (expectedType === 'ont') {
    if (isOntFormat) {
      return { status: 'present_valid', message: `Present in 1Map ✓ (${masked})` };
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
    if (isGizzuFormat) {
      return { status: 'present_valid', message: `Present in 1Map ✓ (${masked})` };
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
 * Format serial validation results for WhatsApp feedback.
 * Returns formatted lines for both ONT and UPS.
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

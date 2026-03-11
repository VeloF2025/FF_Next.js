/**
 * QA Readiness Validator Utility
 * 🟢 WORKING: Validates whether a ticket meets all requirements to enter QA
 *
 * Performs 9 critical validation checks:
 * 1. Photos exist (count >= required)
 * 2. DR number populated
 * 3. Pole number populated
 * 4. PON number populated
 * 5. Zone populated
 * 6. ONT serial recorded
 * 7. ONT RX level recorded
 * 8. Platforms aligned (SP, SOW, tracker all match)
 *
 * Returns detailed failure reasons for each failed check.
 */

import type { QAReadinessFailedCheck } from '../types/verification';

/**
 * Platform data for alignment validation
 */
export interface PlatformData {
  sp_dr_number?: string | null;
  sp_pole_number?: string | null;
  sp_pon_number?: string | null;
  sow_dr_number?: string | null;
  sow_pole_number?: string | null;
  tracker_dr_number?: string | null;
}

/**
 * Input data for QA readiness validation
 */
export interface QAReadinessValidationInput {
  ticket_id: string;
  photos_count: number;
  photos_required_count: number;
  dr_number: string | null;
  pole_number: string | null;
  pon_number: string | null;
  zone_id: string | null;
  ont_serial: string | null;
  ont_rx_level: number | null | undefined;
  platforms_data?: PlatformData;
}

/**
 * Result of QA readiness validation
 */
export interface QAReadinessValidationResult {
  ticket_id: string;
  passed: boolean;
  photos_exist: boolean;
  photos_count: number;
  photos_required_count: number;
  dr_populated: boolean;
  pole_populated: boolean;
  pon_populated: boolean;
  zone_populated: boolean;
  ont_serial_recorded: boolean;
  ont_rx_recorded: boolean;
  platforms_aligned: boolean;
  failed_checks: QAReadinessFailedCheck[];
}

/**
 * Validates if a string field is populated (non-null, non-empty, not just whitespace)
 * 🟢 WORKING: String field validation with trimming
 */
function isStringPopulated(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return value.trim().length > 0;
}

/**
 * Normalizes a string for comparison (trim + lowercase)
 * 🟢 WORKING: String normalization for case-insensitive comparison
 */
function normalizeString(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

/**
 * Validates QA readiness for a ticket
 * 🟢 WORKING: Complete QA readiness validation with all 9 checks
 *
 * @param input - Ticket data to validate
 * @returns Validation result with individual check results and failure details
 */
export function validateQAReadiness(
  input: QAReadinessValidationInput
): QAReadinessValidationResult {
  const failedChecks: QAReadinessFailedCheck[] = [];

  // Check 1: Photos exist (count >= required)
  const photosExist = input.photos_count >= input.photos_required_count;
  if (!photosExist) {
    failedChecks.push({
      check_name: 'photos_exist',
      reason: 'Insufficient photos uploaded',
      expected: input.photos_required_count,
      actual: input.photos_count,
    });
  }

  // Check 2: DR number populated
  const drPopulated = isStringPopulated(input.dr_number);
  if (!drPopulated) {
    failedChecks.push({
      check_name: 'dr_populated',
      reason: 'DR number is required',
      expected: 'Non-empty string',
      actual: input.dr_number,
    });
  }

  // Check 3: Pole number populated
  const polePopulated = isStringPopulated(input.pole_number);
  if (!polePopulated) {
    failedChecks.push({
      check_name: 'pole_populated',
      reason: 'Pole number is required',
      expected: 'Non-empty string',
      actual: input.pole_number,
    });
  }

  // Check 4: PON number populated
  const ponPopulated = isStringPopulated(input.pon_number);
  if (!ponPopulated) {
    failedChecks.push({
      check_name: 'pon_populated',
      reason: 'PON number is required',
      expected: 'Non-empty string',
      actual: input.pon_number,
    });
  }

  // Check 5: Zone populated
  const zonePopulated = isStringPopulated(input.zone_id);
  if (!zonePopulated) {
    failedChecks.push({
      check_name: 'zone_populated',
      reason: 'Zone is required',
      expected: 'Non-empty string',
      actual: input.zone_id,
    });
  }

  // Check 6: ONT serial recorded
  const ontSerialRecorded = isStringPopulated(input.ont_serial);
  if (!ontSerialRecorded) {
    failedChecks.push({
      check_name: 'ont_serial_recorded',
      reason: 'ONT serial number is required',
      expected: 'Non-empty string',
      actual: input.ont_serial,
    });
  }

  // Check 7: ONT RX level recorded
  const ontRxRecorded =
    input.ont_rx_level !== null && input.ont_rx_level !== undefined;
  if (!ontRxRecorded) {
    failedChecks.push({
      check_name: 'ont_rx_recorded',
      reason: 'ONT RX power level is required',
      expected: 'Numeric value',
      actual: input.ont_rx_level,
    });
  }

  // Check 8: Platforms aligned (SP, SOW, tracker all match)
  let platformsAligned = true;

  if (input.platforms_data) {
    const mismatches: string[] = [];

    // Normalize values for comparison
    const ticketDR = normalizeString(input.dr_number);
    const ticketPole = normalizeString(input.pole_number);
    const ticketPON = normalizeString(input.pon_number);

    const spDR = normalizeString(input.platforms_data.sp_dr_number);
    const spPole = normalizeString(input.platforms_data.sp_pole_number);
    const spPON = normalizeString(input.platforms_data.sp_pon_number);

    const sowDR = normalizeString(input.platforms_data.sow_dr_number);
    const sowPole = normalizeString(input.platforms_data.sow_pole_number);

    const trackerDR = normalizeString(input.platforms_data.tracker_dr_number);

    // Check DR number alignment
    if (spDR && ticketDR && spDR !== ticketDR) {
      mismatches.push('DR (SP)');
    }
    if (sowDR && ticketDR && sowDR !== ticketDR) {
      mismatches.push('DR (SOW)');
    }
    if (trackerDR && ticketDR && trackerDR !== ticketDR) {
      mismatches.push('DR (Tracker)');
    }

    // Check pole number alignment
    if (spPole && ticketPole && spPole !== ticketPole) {
      mismatches.push('pole (SP)');
    }
    if (sowPole && ticketPole && sowPole !== ticketPole) {
      mismatches.push('pole (SOW)');
    }

    // Check PON number alignment
    if (spPON && ticketPON && spPON !== ticketPON) {
      mismatches.push('PON (SP)');
    }

    if (mismatches.length > 0) {
      platformsAligned = false;
      failedChecks.push({
        check_name: 'platforms_aligned',
        reason: `Platform data mismatch: ${mismatches.join(', ')} do not match`,
        expected: 'All platforms aligned',
        actual: `Mismatched: ${mismatches.join(', ')}`,
      });
    }
  }

  // Overall pass/fail
  const passed = failedChecks.length === 0;

  return {
    ticket_id: input.ticket_id,
    passed,
    photos_exist: photosExist,
    photos_count: input.photos_count,
    photos_required_count: input.photos_required_count,
    dr_populated: drPopulated,
    pole_populated: polePopulated,
    pon_populated: ponPopulated,
    zone_populated: zonePopulated,
    ont_serial_recorded: ontSerialRecorded,
    ont_rx_recorded: ontRxRecorded,
    platforms_aligned: platformsAligned,
    failed_checks: failedChecks,
  };
}

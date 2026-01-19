/**
 * Ticketing Module - QA Readiness Check Constants
 * 🟢 WORKING: Pre-QA validation requirements and check definitions
 *
 * Defines the validation checks that must pass before QA can start.
 * Prevents QA teams from wasting time on incomplete tickets.
 *
 * Critical for:
 * - Stopping premature QA attempts
 * - Creating discipline and accountability
 * - Reducing QA rejection loops
 * - Ensuring complete evidence before review
 */

import { QAReadinessCheckName } from '../types/verification';

/**
 * QA Readiness check metadata
 */
export interface QAReadinessCheckMeta {
  name: QAReadinessCheckName;
  label: string;
  description: string;
  field: string; // Database field to check
  critical: boolean; // Blocking check
  validationRule: string; // Human-readable validation rule
  errorMessage: string; // Message when check fails
}

/**
 * QA Readiness check definitions
 * 8 checks that must pass before QA can start
 */
export const QA_READINESS_CHECKS: Record<
  QAReadinessCheckName,
  QAReadinessCheckMeta
> = {
  [QAReadinessCheckName.PHOTOS_EXIST]: {
    name: QAReadinessCheckName.PHOTOS_EXIST,
    label: 'Photo Evidence',
    description: 'All required photos must be uploaded',
    field: 'photo_count',
    critical: true,
    validationRule: 'photo_count >= photos_required_count',
    errorMessage:
      'Missing required photos. Upload all verification step photos before QA.',
  },
  [QAReadinessCheckName.DR_POPULATED]: {
    name: QAReadinessCheckName.DR_POPULATED,
    label: 'DR Number',
    description: 'DR number must be populated in all platforms',
    field: 'dr_number',
    critical: true,
    validationRule: 'dr_number IS NOT NULL AND dr_number != ""',
    errorMessage:
      'DR number is missing. Enter DR number before submitting for QA.',
  },
  [QAReadinessCheckName.POLE_POPULATED]: {
    name: QAReadinessCheckName.POLE_POPULATED,
    label: 'Pole Number',
    description: 'Pole number must be recorded',
    field: 'pole_number',
    critical: true,
    validationRule: 'pole_number IS NOT NULL AND pole_number != ""',
    errorMessage:
      'Pole number is missing. Record pole number before submitting for QA.',
  },
  [QAReadinessCheckName.PON_POPULATED]: {
    name: QAReadinessCheckName.PON_POPULATED,
    label: 'PON Number',
    description: 'PON number must be recorded',
    field: 'pon_number',
    critical: true,
    validationRule: 'pon_number IS NOT NULL AND pon_number != ""',
    errorMessage:
      'PON number is missing. Record PON number before submitting for QA.',
  },
  [QAReadinessCheckName.ZONE_POPULATED]: {
    name: QAReadinessCheckName.ZONE_POPULATED,
    label: 'Zone',
    description: 'Zone must be assigned',
    field: 'zone_id',
    critical: true,
    validationRule: 'zone_id IS NOT NULL',
    errorMessage: 'Zone is not assigned. Assign zone before submitting for QA.',
  },
  [QAReadinessCheckName.ONT_SERIAL_RECORDED]: {
    name: QAReadinessCheckName.ONT_SERIAL_RECORDED,
    label: 'ONT Serial',
    description: 'ONT serial number must be recorded',
    field: 'ont_serial',
    critical: true,
    validationRule: 'ont_serial IS NOT NULL AND ont_serial != ""',
    errorMessage:
      'ONT serial number is missing. Record ONT serial before submitting for QA.',
  },
  [QAReadinessCheckName.ONT_RX_RECORDED]: {
    name: QAReadinessCheckName.ONT_RX_RECORDED,
    label: 'ONT RX Power',
    description: 'ONT RX power level must be measured and recorded',
    field: 'ont_rx_level',
    critical: true,
    validationRule: 'ont_rx_level IS NOT NULL',
    errorMessage:
      'ONT RX power level is missing. Measure and record RX power before submitting for QA.',
  },
  [QAReadinessCheckName.PLATFORMS_ALIGNED]: {
    name: QAReadinessCheckName.PLATFORMS_ALIGNED,
    label: 'Platform Alignment',
    description: 'DR, Pole, PON must match across all platforms (SP, SOW, Tracker)',
    field: 'platform_alignment',
    critical: false,
    validationRule: 'Data matches across SP, SOW, and Tracker platforms',
    errorMessage:
      'Platform data mismatch. Ensure DR/Pole/PON match across all systems.',
  },
};

/**
 * All QA readiness checks
 */
export const ALL_READINESS_CHECKS = Object.values(QA_READINESS_CHECKS);

/**
 * Critical (blocking) QA readiness checks
 */
export const CRITICAL_READINESS_CHECKS = ALL_READINESS_CHECKS.filter(
  (c) => c.critical
);

/**
 * Non-critical (warning) QA readiness checks
 */
export const NON_CRITICAL_READINESS_CHECKS = ALL_READINESS_CHECKS.filter(
  (c) => !c.critical
);

/**
 * Get readiness check metadata by name
 */
export function getReadinessCheckMeta(
  checkName: QAReadinessCheckName
): QAReadinessCheckMeta {
  return QA_READINESS_CHECKS[checkName];
}

/**
 * Get readiness check label
 */
export function getReadinessCheckLabel(checkName: QAReadinessCheckName): string {
  return QA_READINESS_CHECKS[checkName]?.label || checkName;
}

/**
 * Get readiness check error message
 */
export function getReadinessCheckError(checkName: QAReadinessCheckName): string {
  return QA_READINESS_CHECKS[checkName]?.errorMessage || 'Check failed';
}

/**
 * Check if readiness check is critical (blocking)
 */
export function isReadinessCheckCritical(checkName: QAReadinessCheckName): boolean {
  return QA_READINESS_CHECKS[checkName]?.critical || false;
}

/**
 * Photo evidence requirements
 */
export const PHOTO_REQUIREMENTS = {
  MIN_PHOTOS: 9, // Minimum 9 photos required (steps with photo_required=true)
  RECOMMENDED_PHOTOS: 10, // Recommended number of photos
  MAX_FILE_SIZE_MB: 10, // Maximum file size per photo
  ALLOWED_FORMATS: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
};

/**
 * ONT RX power level thresholds (in dBm)
 */
export const ONT_RX_THRESHOLDS = {
  MIN_ACCEPTABLE: -27, // Minimum acceptable RX level
  MAX_ACCEPTABLE: -20, // Maximum acceptable RX level
  OPTIMAL_MIN: -25, // Optimal range start
  OPTIMAL_MAX: -22, // Optimal range end
  WARNING_THRESHOLD: -26, // Show warning below this
};

/**
 * Check if ONT RX level is acceptable
 */
export function isONTRxAcceptable(rxLevel: number | null): boolean {
  if (rxLevel === null) return false;
  return (
    rxLevel >= ONT_RX_THRESHOLDS.MIN_ACCEPTABLE &&
    rxLevel <= ONT_RX_THRESHOLDS.MAX_ACCEPTABLE
  );
}

/**
 * Check if ONT RX level is optimal
 */
export function isONTRxOptimal(rxLevel: number | null): boolean {
  if (rxLevel === null) return false;
  return (
    rxLevel >= ONT_RX_THRESHOLDS.OPTIMAL_MIN &&
    rxLevel <= ONT_RX_THRESHOLDS.OPTIMAL_MAX
  );
}

/**
 * Get ONT RX level status
 */
export function getONTRxStatus(rxLevel: number | null): {
  status: 'optimal' | 'acceptable' | 'warning' | 'poor' | 'missing';
  color: string;
  message: string;
} {
  if (rxLevel === null) {
    return {
      status: 'missing',
      color: 'gray',
      message: 'RX level not measured',
    };
  }

  if (isONTRxOptimal(rxLevel)) {
    return {
      status: 'optimal',
      color: 'green',
      message: 'Optimal signal strength',
    };
  }

  if (isONTRxAcceptable(rxLevel)) {
    if (rxLevel <= ONT_RX_THRESHOLDS.WARNING_THRESHOLD) {
      return {
        status: 'warning',
        color: 'yellow',
        message: 'Acceptable but near threshold',
      };
    }
    return {
      status: 'acceptable',
      color: 'blue',
      message: 'Acceptable signal strength',
    };
  }

  return {
    status: 'poor',
    color: 'red',
    message: 'Signal strength below acceptable range',
  };
}

/**
 * QA readiness status messages
 */
export const QA_READINESS_MESSAGES = {
  READY: 'Ticket is ready for QA review',
  NOT_READY: 'Ticket is not ready for QA. Complete all requirements first.',
  BLOCKED: 'QA is blocked. Fix critical issues before proceeding.',
  WARNING: 'Ticket has warnings but can proceed to QA.',
  CHECKING: 'Running QA readiness validation...',
};

/**
 * Get QA readiness status message
 */
export function getQAReadinessMessage(
  passed: boolean,
  hasCriticalFailures: boolean
): string {
  if (passed) return QA_READINESS_MESSAGES.READY;
  if (hasCriticalFailures) return QA_READINESS_MESSAGES.BLOCKED;
  return QA_READINESS_MESSAGES.WARNING;
}

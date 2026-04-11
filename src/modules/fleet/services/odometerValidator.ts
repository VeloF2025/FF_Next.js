/**
 * Odometer Validator
 *
 * Purpose: Validate extracted odometer readings against previous values,
 * detect digit confusion patterns, and flag suspicious jumps.
 * Also provides the checkOdometerDiscrepancy helper for check-in flows.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface OdometerValidationResult {
  isValid: boolean;
  validatedReading: number | null;
  originalReading: number | null;
  warning: string | null;
  warningLevel: 'none' | 'low' | 'medium' | 'high';
  suggestedAction: 'accept' | 'verify' | 'reject';
}

// ============================================================================
// DIGIT CONFUSION DETECTION
// ============================================================================

/**
 * Detect common digit confusion patterns between two number strings.
 * Returns a description of the confusion or null if no pattern found.
 */
export function detectDigitConfusion(
  str1: string,
  str2: string
): string | null {
  if (str1.length !== str2.length) return null;

  const confusionPairs: Record<string, string[]> = {
    '1': ['6', '7'],
    '6': ['1', '8'],
    '2': ['3', '7'],
    '3': ['2', '8'],
    '7': ['1', '2'],
    '8': ['3', '6', '0'],
    '0': ['8', '6'],
  };

  const differences: string[] = [];
  for (let i = 0; i < str1.length; i++) {
    if (str1[i] !== str2[i]) {
      const d1 = str1[i]!;
      const d2 = str2[i]!;
      if (
        confusionPairs[d1]?.includes(d2) ||
        confusionPairs[d2]?.includes(d1)
      ) {
        differences.push(`position ${i + 1}: ${d1}↔${d2}`);
      }
    }
  }

  return differences.length > 0 ? differences.join(', ') : null;
}

/**
 * Detect digit confusion patterns for validation (requires large diff and same length).
 */
function detectDigitConfusionValidation(
  extractedStr: string,
  previousStr: string,
  kmDiff: number
): { description: string; likelyCorrect: number } | null {
  if (extractedStr.length !== previousStr.length || kmDiff < 5000) {
    return null;
  }

  const confusionMap: Record<string, string[]> = {
    '1': ['6', '7'],
    '6': ['1', '8'],
    '2': ['3', '7'],
    '3': ['2', '8'],
    '7': ['1', '2'],
    '8': ['3', '6', '0'],
    '0': ['8', '6'],
  };

  const diffPositions: { pos: number; extracted: string; previous: string }[] = [];
  for (let i = 0; i < extractedStr.length; i++) {
    if (extractedStr[i] !== previousStr[i]) {
      diffPositions.push({ pos: i, extracted: extractedStr[i], previous: previousStr[i] });
    }
  }

  if (diffPositions.length >= 1 && diffPositions.length <= 2) {
    const confusedDigits = diffPositions.filter(
      (d) =>
        confusionMap[d.previous]?.includes(d.extracted) ||
        confusionMap[d.extracted]?.includes(d.previous)
    );

    if (confusedDigits.length === diffPositions.length) {
      const description = confusedDigits
        .map((d) => `${d.extracted}↔${d.previous} at position ${d.pos + 1}`)
        .join(', ');

      const correctedStr = extractedStr.split('');
      confusedDigits.forEach((d) => { correctedStr[d.pos] = d.previous; });
      const likelyCorrect = parseInt(correctedStr.join(''), 10);

      return { description, likelyCorrect };
    }
  }

  return null;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate odometer reading against previous value and VLM confidence.
 * STRICT MODE: Rejects readings with impossible jumps (likely VLM digit confusion).
 */
export function validateOdometerReading(
  extractedReading: number | null,
  confidence: number,
  previousReading: number | null,
  options?: {
    maxDailyKm?: number;
    maxSingleTripKm?: number;
    minConfidence?: number;
    daysSinceLast?: number;
  }
): OdometerValidationResult {
  const {
    maxDailyKm = 500,
    maxSingleTripKm = 1000,
    minConfidence = 0.85,
    daysSinceLast = 1,
  } = options || {};

  if (extractedReading === null) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: null,
      warning: 'Could not extract odometer reading from image',
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  if (extractedReading < 0 || extractedReading > 2000000) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Reading ${extractedReading} km is outside reasonable range (0-2,000,000)`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  if (confidence < minConfidence) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Low VLM confidence (${Math.round(confidence * 100)}%) - verify manually`,
      warningLevel: 'medium',
      suggestedAction: 'verify',
    };
  }

  if (previousReading === null) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: null,
      warningLevel: 'none',
      suggestedAction: 'accept',
    };
  }

  const kmDifference = extractedReading - previousReading;

  if (kmDifference < -10) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Odometer appears to have gone backwards: ${extractedReading} km < previous ${previousReading} km`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  const proportionalMaxKm = Math.max(
    maxDailyKm * Math.max(daysSinceLast, 1),
    maxSingleTripKm
  );

  const digitConfusion = detectDigitConfusionValidation(
    extractedReading.toString(),
    previousReading.toString(),
    kmDifference
  );

  if (digitConfusion) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `VLM digit confusion detected: ${digitConfusion.description}. Reading ${extractedReading} km likely misread from ~${digitConfusion.likelyCorrect} km`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  if (kmDifference > proportionalMaxKm * 5) {
    return {
      isValid: false,
      validatedReading: null,
      originalReading: extractedReading,
      warning: `Impossible km jump: ${kmDifference} km in ${daysSinceLast} day(s) (max expected: ${proportionalMaxKm} km). Likely VLM misread.`,
      warningLevel: 'high',
      suggestedAction: 'reject',
    };
  }

  if (kmDifference > proportionalMaxKm * 2) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Large km increase: ${kmDifference} km in ${daysSinceLast} day(s) - verify if correct`,
      warningLevel: 'high',
      suggestedAction: 'verify',
    };
  }

  if (kmDifference > maxSingleTripKm) {
    return {
      isValid: true,
      validatedReading: extractedReading,
      originalReading: extractedReading,
      warning: `Above normal km: ${kmDifference} km since last reading`,
      warningLevel: 'medium',
      suggestedAction: 'verify',
    };
  }

  return {
    isValid: true,
    validatedReading: extractedReading,
    originalReading: extractedReading,
    warning: null,
    warningLevel: 'none',
    suggestedAction: 'accept',
  };
}

// ============================================================================
// DISCREPANCY CHECK
// ============================================================================

/**
 * Calculate odometer discrepancy.
 *
 * @param current - Current odometer reading
 * @param previous - Previous odometer reading
 * @param daysSince - Days since last reading
 * @param dailyThreshold - Max expected km per day
 * @returns Discrepancy info
 */
export function checkOdometerDiscrepancy(
  current: number,
  previous: number | null,
  daysSince: number,
  dailyThreshold: number
): { isDiscrepancy: boolean; reason: string | null } {
  if (previous === null) {
    return { isDiscrepancy: false, reason: null };
  }

  const kmSinceLast = current - previous;

  if (kmSinceLast < 0) {
    return {
      isDiscrepancy: true,
      reason: `Odometer rollback detected: ${current} km is less than previous ${previous} km`,
    };
  }

  const maxExpectedKm = daysSince * dailyThreshold;
  if (kmSinceLast > maxExpectedKm) {
    const avgPerDay = Math.round(kmSinceLast / daysSince);
    return {
      isDiscrepancy: true,
      reason: `Excessive km: ${kmSinceLast} km in ${daysSince} days (${avgPerDay} km/day vs ${dailyThreshold} km/day threshold)`,
    };
  }

  if (daysSince >= 7 && kmSinceLast === 0) {
    return {
      isDiscrepancy: true,
      reason: `Static odometer: ${current} km unchanged for ${daysSince} days`,
    };
  }

  return { isDiscrepancy: false, reason: null };
}

// Suppress unused import warning
void (log as unknown);

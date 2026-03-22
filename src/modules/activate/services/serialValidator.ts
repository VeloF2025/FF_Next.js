/**
 * Serial Validator
 *
 * Purpose: Serial format validation, fuzzy matching with Levenshtein distance,
 * serial type detection (ONT vs UPS/Gizzu), masking, and feedback formatting.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fuzzy matching threshold — max character differences allowed.
 * 2 characters allows for common OCR errors:
 * - ALCLB48AD3W vs ALCLB48AD39F (2 chars)
 * - ALCLB4ACB04 vs ALCLB48ACB04 (1 char missing)
 */
const FUZZY_MATCH_MAX_DISTANCE = 2;

/**
 * Minimum confidence for fuzzy match (0-1).
 * With 12-char serials, 2 errors = 83% confidence.
 */
const FUZZY_MATCH_MIN_CONFIDENCE = 0.8;

/**
 * ONT Serial regex pattern (Nokia ONT).
 * Matches: ALCLB463EE35, ALCB480FE3D, ALCLB48CC3CA
 * Format: ALCL or ALCB followed by alphanumeric
 */
const ONT_SERIAL_PATTERN = /^ALC[LB][A-Z0-9]{7,10}$/i;

/**
 * Gizzu UPS Serial regex pattern.
 * Matches: GU18W12V2508057584, GU18W12V2508035029
 * Format: GU18W followed by alphanumeric (typically 15-20 chars total)
 */
const GIZZU_SERIAL_PATTERN = /^GU18W[A-Z0-9]{10,16}$/i;

/**
 * UPS Serial length range (for non-Gizzu UPS).
 */
const UPS_SERIAL_MIN_LENGTH = 8;
const UPS_SERIAL_MAX_LENGTH = 20;

// ============================================================================
// LEVENSHTEIN DISTANCE
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits needed to transform
 * one string into the other.
 *
 * Uses optimised space approach with two rows instead of full matrix.
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let currRow: number[] = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        currRow[j] = prevRow[j - 1]!;
      } else {
        currRow[j] =
          1 +
          Math.min(
            prevRow[j]!,      // deletion
            currRow[j - 1]!,  // insertion
            prevRow[j - 1]!   // substitution
          );
      }
    }

    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n]!;
}

// ============================================================================
// FUZZY MATCHING
// ============================================================================

/**
 * Fuzzy serial matching result.
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
 * Fuzzy match two serial numbers.
 *
 * Handles common OCR errors like:
 * - ALCLB48AD3W vs ALCLB48AD39F (W vs 9F = 2 chars)
 * - ALCLB4ACB04 vs ALCLB48ACB04 (missing 8 = 1 char)
 * - ALCLB48CC3CA vs ALCLB488CC3CA (extra 8 = 1 char)
 *
 * @param serial1 - First serial (typically from VLM extraction)
 * @param serial2 - Second serial (typically from OneMap)
 * @returns FuzzyMatchResult with match status and confidence
 */
export function fuzzySerialMatch(
  serial1: string | null,
  serial2: string | null
): FuzzyMatchResult {
  if (!serial1 || !serial2) {
    return {
      isMatch: false,
      isExactMatch: false,
      isFuzzyMatch: false,
      distance: -1,
      confidence: 0,
      details: serial1
        ? 'Second serial is null/empty'
        : 'First serial is null/empty',
    };
  }

  const s1 = serial1.trim().toUpperCase().replace(/[\s-]/g, '');
  const s2 = serial2.trim().toUpperCase().replace(/[\s-]/g, '');

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

  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const confidence = maxLen > 0 ? 1 - distance / maxLen : 0;

  const isFuzzyMatch =
    distance <= FUZZY_MATCH_MAX_DISTANCE &&
    confidence >= FUZZY_MATCH_MIN_CONFIDENCE;

  let details: string;
  if (isFuzzyMatch) {
    details = `Fuzzy match: ${distance} character difference(s) (${(confidence * 100).toFixed(0)}% confidence)`;
  } else if (distance <= FUZZY_MATCH_MAX_DISTANCE) {
    details = `Near match but below confidence threshold: ${distance} diff, ${(confidence * 100).toFixed(0)}% confidence (min: ${FUZZY_MATCH_MIN_CONFIDENCE * 100}%)`;
  } else {
    details = `No match: ${distance} character differences (max allowed: ${FUZZY_MATCH_MAX_DISTANCE})`;
  }

  log.debug(
    `Fuzzy match: "${s1}" vs "${s2}" = ${isFuzzyMatch ? 'MATCH' : 'NO MATCH'}`,
    {
      distance,
      confidence: `${(confidence * 100).toFixed(1)}%`,
      maxAllowed: FUZZY_MATCH_MAX_DISTANCE,
    },
    'QaAutoFail'
  );

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
 * Check if two serials match (exact or fuzzy).
 * Convenience function that returns just a boolean.
 */
export function serialsMatchFuzzy(
  serial1: string | null,
  serial2: string | null
): boolean {
  return fuzzySerialMatch(serial1, serial2).isMatch;
}

// ============================================================================
// FORMAT VALIDATION
// ============================================================================

/**
 * Validate ONT serial format.
 */
export function validateOntSerial(
  serial: string | null
): { valid: boolean; reason: string } {
  if (!serial) {
    return { valid: false, reason: 'ONT serial not provided' };
  }

  const trimmed = serial.trim();
  if (trimmed.length < 11 || trimmed.length > 12) {
    return {
      valid: false,
      reason: `Invalid length: ${trimmed.length} (expected 11-12)`,
    };
  }

  if (!ONT_SERIAL_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'Does not match ALCL/ALCB pattern' };
  }

  return { valid: true, reason: 'Valid ONT serial format' };
}

/**
 * Validate UPS serial format.
 */
export function validateUpsSerial(
  serial: string | null
): { valid: boolean; reason: string } {
  if (!serial) {
    return { valid: false, reason: 'UPS serial not provided' };
  }

  const trimmed = serial.trim();
  if (
    trimmed.length < UPS_SERIAL_MIN_LENGTH ||
    trimmed.length > UPS_SERIAL_MAX_LENGTH
  ) {
    return {
      valid: false,
      reason: `Invalid length: ${trimmed.length} (expected ${UPS_SERIAL_MIN_LENGTH}-${UPS_SERIAL_MAX_LENGTH})`,
    };
  }

  return { valid: true, reason: 'Valid UPS serial format' };
}

// ============================================================================
// TYPE DETECTION
// ============================================================================

/**
 * Check if a serial looks like a Nokia ONT serial (ALCL/ALCB pattern).
 */
export function looksLikeOntSerial(serial: string | null): boolean {
  if (!serial) return false;
  return ONT_SERIAL_PATTERN.test(serial.trim());
}

/**
 * Check if a serial looks like a Gizzu UPS serial (GU18W pattern).
 */
export function looksLikeGizzuSerial(serial: string | null): boolean {
  if (!serial) return false;
  return GIZZU_SERIAL_PATTERN.test(serial.trim());
}

/**
 * Detect if ONT and UPS serials appear to be swapped.
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
    return {
      swapped: true,
      details: `Serials appear SWAPPED: ONT field has Gizzu serial (${ontSerial}), UPS field has ONT serial (${upsSerial})`,
    };
  }

  if (ontLooksLikeGizzu) {
    return {
      swapped: true,
      details: `ONT field contains Gizzu serial (${ontSerial}) - please swap in 1Map`,
    };
  }

  if (upsLooksLikeOnt) {
    return {
      swapped: true,
      details: `UPS field contains ONT serial (${upsSerial}) - please swap in 1Map`,
    };
  }

  return { swapped: false, details: 'Serials appear correctly assigned' };
}

// ============================================================================
// MASKING
// ============================================================================

/**
 * Mask a serial number for display (privacy + verification).
 * Shows first 3-4 chars and last 4 chars with *** in between.
 *
 * Examples:
 *   ALCLB48CC3CA -> ALC***3CA
 *   GU18W12V2508057584 -> GU18***7584
 */
export function maskSerial(serial: string | null): string {
  if (!serial) return 'N/A';
  const trimmed = serial.trim();
  if (trimmed.length <= 6) return trimmed;

  if (trimmed.toUpperCase().startsWith('ALC')) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
  }

  if (trimmed.toUpperCase().startsWith('GU18')) {
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
  }

  return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
}

// Status and feedback helpers live in serialFeedback.ts to keep this file
// within the 400-line limit. They are re-exported from qaAutoFailService.ts.
export type { SerialStatus } from './serialFeedback';
export { getSerialStatus, formatSerialFeedback } from './serialFeedback';

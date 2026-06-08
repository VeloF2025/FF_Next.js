export const ONT_SERIAL_PREFIX = 'ALCL';
export const UPS_SERIAL_PREFIX = 'GU';

export type SerialDevice = 'ont' | 'ups';

export interface FormatValidationResult {
  valid: boolean;
  normalised: string;   // trimmed + uppercased
  message: string;
}

/**
 * Validates the serial format for the given device at scan time.
 * ONT serials must start with ALCL (Nokia).
 * UPS serials must start with GU (Gizzu).
 */
export function validateSerialFormat(
  raw: string,
  device: SerialDevice,
): FormatValidationResult {
  const normalised = raw.trim().toUpperCase();
  const prefix = device === 'ont' ? ONT_SERIAL_PREFIX : UPS_SERIAL_PREFIX;

  if (!normalised.startsWith(prefix)) {
    return {
      valid: false,
      normalised,
      message:
        device === 'ont'
          ? `ONT serials must start with ${ONT_SERIAL_PREFIX} (scanned: ${normalised})`
          : `UPS serials must start with ${UPS_SERIAL_PREFIX} (scanned: ${normalised})`,
    };
  }

  return { valid: true, normalised, message: 'Serial format valid' };
}

// ---------------------------------------------------------------------------
// Levenshtein distance — reserved for future async 1Map/OES cross-reference.
// Not used in the scan-time API route.
// ---------------------------------------------------------------------------

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i, ...Array(n).fill(0) as number[]];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Fuzzy serial comparison for async cross-reference (1Map / OES).
 * Allows <=2 character differences to absorb OCR/barcode read noise.
 */
export function serialsMatch(a: string, b: string): boolean {
  const na = a.trim().toUpperCase();
  const nb = b.trim().toUpperCase();
  if (na === nb) return true;
  return levenshteinDistance(na, nb) <= 2;
}

/**
 * batchWarning — soft guard on issue size.
 *
 * A ten-unit handout (one carton of nine plus a loose unit) is the normal day.
 * Beyond that is usually a double-scan, but kitting out a crew is legitimate —
 * so this returns a message to show, never a reason to disable submit.
 */

export const SOFT_BATCH_WARN_AT = 10;

export function batchWarning(validCount: number): string | null {
  if (validCount <= SOFT_BATCH_WARN_AT) return null;
  return `That's ${validCount} units in one issue — more than the usual ${SOFT_BATCH_WARN_AT}. Double-scanned?`;
}

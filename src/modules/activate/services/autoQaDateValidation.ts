/**
 * Date helpers used by the auto-QA pipeline to detect re-photographed content.
 *
 * Extracted from autoQaProcessor.ts to keep that file under the 300-line
 * CLAUDE.md limit. The auto-QA processor re-exports these symbols so existing
 * callers (e.g. autoQaProcessor.date-validation.test.ts) keep their import
 * paths stable.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('AutoQA');

/**
 * Minimum VLM categorization run date for which date-stamp validation is active.
 *
 * Option B: we skip the duplicate-photo date-mismatch rule for DRs whose VLM
 * categorization ran before this cutoff, because those older runs pre-date
 * the `vlm_date_stamps` extraction feature and will always produce empty
 * arrays — applying the rule would be a no-op but being explicit guards
 * against future backfill attempts replaying historic data with incorrect
 * verdicts.
 */
export const VLM_DATE_VALIDATION_ACTIVE_FROM = '2026-04-21';

/**
 * Accepts only the strict ISO-8601-ish formats the VLM is instructed to emit:
 *   YYYY-MM-DD
 *   YYYY-MM-DDTHH:MM
 *   YYYY-MM-DDTHH:MM:SS
 *   YYYY-MM-DD HH:MM
 *   YYYY-MM-DD HH:MM:SS
 */
const STRICT_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

/**
 * Format a Date as `YYYY-MM-DD` in SAST (Africa/Johannesburg).
 *
 * `en-CA` is used because it produces the canonical YYYY-MM-DD format without
 * locale separators. This avoids the UTC-drift bug where
 * `toISOString().split('T')[0]` can return the previous calendar day for a
 * SAST date at or near midnight.
 */
export function toSastYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Parse a raw VLM date string. Returns a Date if it passes strict format
 * checks, or null if it should be rejected.
 *
 * Ambiguous formats like `10/3/2026` or `03/10/2026` are always rejected to
 * prevent silent MM/DD vs DD/MM misinterpretation.
 */
export function parseStrictVlmDate(raw: string, dropNumber: string): Date | null {
  if (!STRICT_DATE_RE.test(raw)) {
    log.warn(
      `VLM_DATE_EXTRACTION_REJECTED: ambiguous/non-ISO format "${raw}" for DR ${dropNumber} — skipped`,
    );
    return null;
  }

  const d = new Date(
    raw.includes('T') || raw.includes(' ')
      ? raw.replace(' ', 'T')
      : `${raw}T00:00:00Z`,
  );

  if (isNaN(d.getTime())) {
    log.warn(
      `VLM_DATE_EXTRACTION_REJECTED: valid format but unparseable "${raw}" for DR ${dropNumber} — skipped`,
    );
    return null;
  }

  // Reject invalid calendar days (e.g. 2026-02-30 silently rolls to 2026-03-02).
  const [yyyy, mm, dd] = raw.slice(0, 10).split('-').map(Number);
  if (
    d.getUTCFullYear() !== yyyy ||
    d.getUTCMonth() + 1 !== mm ||
    d.getUTCDate() !== dd
  ) {
    log.warn(
      `VLM_DATE_EXTRACTION_REJECTED: invalid calendar date "${raw}" for DR ${dropNumber} — skipped`,
    );
    return null;
  }

  return d;
}

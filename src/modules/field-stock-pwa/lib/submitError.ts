/**
 * formatSubmitError — turn a submit failure into the message the stores
 * person actually needs.
 *
 * The API envelope's top-level message for a 422 is the generic "Validation
 * failed"; the actionable text ("No stock of FT-ONT recorded at Garstfontein
 * DC") lives in error.details values. Surface those when present.
 */

import { ApiError } from '../api/request';

const FALLBACK_MESSAGE = 'An unexpected error occurred. Please try again.';

export function formatSubmitError(err: unknown): string {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.details) {
    const detailMessages = Object.values(err.details).filter(
      (v): v is string => typeof v === 'string'
    );
    if (detailMessages.length > 0) return detailMessages.join(' ');
  }
  return err instanceof Error ? err.message : FALLBACK_MESSAGE;
}

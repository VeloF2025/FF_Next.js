/**
 * Pure mapping from ApiError / ImageDecodeError / unknown to the state the
 * clock page should enter next.
 *
 * Kept out of the page component so (a) the page stays under the 300-line
 * project budget and (b) this is unit-testable without a render.
 */

import { ApiError } from './api';
import { ImageDecodeError } from './imageUtils';

export type ClockAction = 'in' | 'out';

export type ErrorHandling =
  | { kind: 'consent_required' }
  | { kind: 'error'; message: string };

export function mapImageError(err: unknown): ErrorHandling {
  if (err instanceof ImageDecodeError) {
    return {
      kind: 'error',
      message: 'This photo format isn\u2019t supported on this phone. Please retake the photo.',
    };
  }
  return { kind: 'error', message: 'Could not process the selfie. Please retake it.' };
}

export function mapSubmitError(err: unknown, action: ClockAction): ErrorHandling {
  if (!(err instanceof ApiError)) {
    return { kind: 'error', message: 'Submit failed. Please try again.' };
  }

  const reason = (err.details as { reason?: string } | undefined)?.reason;

  // Consent gate — "missing", "revoked", and "revoked_mid_shift" all land on
  // the same re-prompt modal. PR3's clock-out handler grandfathers revoked
  // consent (logs manual_override) but clock-in rightly blocks.
  if (
    err.status === 403 &&
    (reason === 'consent_missing' ||
      reason === 'consent_revoked' ||
      reason === 'consent_revoked_mid_shift')
  ) {
    return { kind: 'consent_required' };
  }

  if (err.status === 409 && reason === 'open_entry' && action === 'in') {
    return { kind: 'error', message: 'You already have an open shift. Go clock out first.' };
  }
  if (err.status === 404 && reason === 'no_open_entry' && action === 'out') {
    return { kind: 'error', message: 'No open shift to clock out from.' };
  }
  if (err.status === 400 && reason === 'clock_skew') {
    return {
      kind: 'error',
      message:
        'Your phone\u2019s time is off. Please check your date/time settings and try again.',
    };
  }
  if (err.code === 'NETWORK_ERROR') {
    return {
      kind: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }

  // Unknown API error — show the server's message but keep the UI in a
  // retry-able state. Avoid echoing INTERNAL_ERROR messages verbatim since
  // those would be user-hostile; fall back to a generic line for 5xx.
  if (err.status >= 500) {
    return { kind: 'error', message: 'Something went wrong on our side. Please try again.' };
  }
  return { kind: 'error', message: err.message || 'Submit failed. Please try again.' };
}

export function mapConsentError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return 'Your attendance profile isn\u2019t fully set up yet. Please complete the PIN onboarding first.';
  }
  if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
    return 'Could not save consent — check your connection and try again.';
  }
  if (err instanceof ApiError) {
    return err.message || 'Could not save consent.';
  }
  return 'Could not save consent.';
}

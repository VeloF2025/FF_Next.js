/**
 * Pure validation for a driver's parking-address capture.
 *
 * Kept outside the route handler for the reason given in the design spec §12:
 * the rules are the part worth testing, and they need no infrastructure.
 *
 * The accuracy gate is the rule that matters. A capture with 500m of error
 * sits inside a 200m compliance radius by luck alone, and every nightly check
 * against that address for the rest of its life inherits the error. Rejecting
 * the capture and asking the driver to step into the open is far cheaper than
 * a disputed violation months later.
 */
import { isValidLatLon } from '@/lib/geo';
import type { DeclarationInput } from './types';

/** Inclusive ceiling, in metres, on the GPS accuracy of a capture. */
export const MAX_CAPTURE_ACCURACY_M = 100;

/** label is VARCHAR(120) in migration 483. */
const MAX_LABEL_LENGTH = 120;
/** request_note is TEXT; this bound is a sanity limit, not a schema one. */
const MAX_NOTE_LENGTH = 1000;

export interface ValidDeclaration {
  lat: number;
  lon: number;
  accuracyM: number;
  label: string | null;
  requestNote: string | null;
}

export type ValidationResult =
  | { ok: true; value: ValidDeclaration }
  | { ok: false; error: string };

type TextResult = { ok: true; value: string | null } | { ok: false; error: string };

function cleanText(value: unknown, max: number, field: string): TextResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, error: `${field} must be ${max} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

export function validateDeclaration(input: DeclarationInput): ValidationResult {
  // Number(null) is 0 and Number(undefined) is NaN. isValidLatLon rejects the
  // second but would happily accept the first as the Gulf of Guinea, so guard
  // null explicitly rather than storing 0,0 as a parking address.
  if (input.lat === null || input.lon === null) {
    return { ok: false, error: 'A valid latitude and longitude are required' };
  }
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!isValidLatLon({ lat, lon })) {
    return { ok: false, error: 'A valid latitude and longitude are required' };
  }

  if (input.accuracyM === undefined || input.accuracyM === null) {
    return { ok: false, error: 'GPS accuracy is required' };
  }
  const accuracyM = Number(input.accuracyM);
  if (!Number.isFinite(accuracyM) || accuracyM < 0) {
    return { ok: false, error: 'GPS accuracy is required' };
  }
  if (accuracyM > MAX_CAPTURE_ACCURACY_M) {
    return {
      ok: false,
      error: `Your location is only accurate to ${Math.round(accuracyM)}m. Move into the open, away from buildings, and try again.`,
    };
  }

  const label = cleanText(input.label, MAX_LABEL_LENGTH, 'Label');
  if (!label.ok) return label;
  const requestNote = cleanText(input.requestNote, MAX_NOTE_LENGTH, 'Note');
  if (!requestNote.ok) return requestNote;

  return {
    ok: true,
    value: { lat, lon, accuracyM, label: label.value, requestNote: requestNote.value },
  };
}

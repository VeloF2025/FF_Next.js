/**
 * Static catalogue of per-adjustment-kind UI hints.
 *
 * Centralises the text shown next to each correction-kind option in
 * the /my portal so the UI doesn't hardcode strings and a typo fix
 * doesn't need a frontend deploy. Served via
 * GET /api/my/attendance-corrections-hints to the portal; also imported
 * by the POST validator to enforce per-kind minimum reason lengths that
 * match the prompt the staff just read.
 *
 * Why per-kind minimums:
 *   'forgot_clock_out' reasons can be one short line ("site fire drill;
 *   phone out of battery"). 'duplicate_entry' reasons need more context
 *   (which of the two is wrong, what time the real clock-in was) so
 *   the reviewer doesn't have to DM the staff for details. Differing
 *   minimums encourage the right shape of message per kind.
 */

import type { AdjustmentKind } from './queries';

export interface AdjustmentHint {
  /** Short human-readable label for the dropdown option. */
  label: string;
  /** Example/placeholder shown inside the reason textarea. */
  placeholder: string;
  /** Supervisor-facing clarification of what this kind means. */
  hint: string;
  /** Minimum reason length (characters) for this kind. */
  minReasonChars: number;
}

/**
 * Absolute floor that any kind's `minReasonChars` must respect so we
 * never accept a one-word reason (spam protection). Mirrored in the
 * POST validator so the catalogue and the handler stay in sync when
 * this bar moves.
 */
export const ABSOLUTE_MIN_REASON_CHARS = 10;

export const ADJUSTMENT_HINTS: Record<AdjustmentKind, AdjustmentHint> = {
  forgot_clock_out: {
    label: 'Forgot to clock out',
    placeholder:
      'e.g. "Left site at 5:15pm for emergency callout, phone dead — real clock-out was approx 17:15."',
    hint: 'You left site without clocking out. Provide the real clock-out time in the adjusted field + a one-line explanation.',
    minReasonChars: 10,
  },
  wrong_clock_in_time: {
    label: 'Wrong clock-in time',
    placeholder:
      'e.g. "Phone GPS was still warming up; actual arrival was 07:45."',
    hint: 'Your clock-in timestamp is off. State the correct time and why the recorded one was wrong.',
    minReasonChars: 10,
  },
  wrong_clock_out_time: {
    label: 'Wrong clock-out time',
    placeholder:
      'e.g. "Tapped clock-out at 17:00 but actually stayed until 18:30 to close out the drop."',
    hint: 'Your clock-out timestamp is off. State the correct time and why the recorded one was wrong.',
    minReasonChars: 10,
  },
  wrong_site: {
    label: 'Wrong site',
    placeholder:
      'e.g. "Auto-assigned Site A based on nearest geofence but I actually worked Site B all shift."',
    hint: 'The entry was attached to the wrong site geofence. Pick the correct site from the adjusted_site_geofence_id dropdown and explain.',
    minReasonChars: 15,
  },
  duplicate_entry: {
    label: 'Duplicate entry',
    placeholder:
      'e.g. "This is a duplicate of entry 2026-04-22 08:00 — the app double-submitted when the network flaked. Keep that one; cancel this."',
    hint: 'This entry is a duplicate of another. Identify which entry is the real one (date + time) and what caused the duplicate so ops can tune the submit guard.',
    minReasonChars: 25,
  },
  other: {
    label: 'Other',
    placeholder:
      'e.g. "Ran two discrete shifts that merged because the first clock-out timed out; need to split into two entries."',
    hint: 'Something not covered by the other categories. Be specific — a vague "other" reason is usually rejected.',
    minReasonChars: 25,
  },
};

/**
 * Lookup helper that never throws. Callers on the UI side can pass an
 * arbitrary string (query param, form field) and get null back for
 * unknown kinds rather than crashing. Callers on the server side that
 * already validated `kind` against `VALID_KINDS` can index directly.
 */
export function getHint(kind: string): AdjustmentHint | null {
  if (Object.prototype.hasOwnProperty.call(ADJUSTMENT_HINTS, kind)) {
    return ADJUSTMENT_HINTS[kind as AdjustmentKind];
  }
  return null;
}

/**
 * Shared neutral copy for the driver Fleet incident portal (PR7 Task 7,
 * design §4/§15). Extracted into its own file — not part of the plan's
 * Task 7 file list, but forced by the 200-line new-component cap — so
 * `DriverIncidentList.tsx`, `DriverIncidentDetail.tsx`, and
 * `DriverResponseForm.tsx` share one wording table instead of drifting
 * into three slightly different versions of the same copy.
 *
 * No "violation"/"fraud"/"misconduct"/"offence" wording anywhere here —
 * see this module's own tests and `AttendanceCorrectionLink.tsx`'s
 * `INELIGIBLE_COPY` for the sibling table this mirrors.
 */
import type { DriverConcernCategory, DriverInputState } from '../types';

export const DRIVER_INPUT_STATE_LABELS: Record<DriverInputState, string> = {
  not_requested: 'No action needed',
  requested: 'Input requested',
  responded: 'You responded',
  expired: 'Response window closed',
  closed: 'Closed',
};

export type ResponseIneligibleReason = 'closed' | 'expired' | 'outside_window';

export const RESPONSE_INELIGIBLE_COPY: Record<ResponseIneligibleReason, string> = {
  closed: 'This incident is closed and no longer accepts a response.',
  expired: 'The window to respond to this request has closed.',
  outside_window: 'The window to respond to this incident has closed.',
};

export const CONCERN_CATEGORY_LABELS: Record<DriverConcernCategory, string> = {
  assignment_error: 'My assignment looks wrong',
  site_error: 'The site looks wrong',
  vehicle_error: 'The vehicle looks wrong',
  geofence_error: 'The site boundary looks wrong',
  other: 'Something else',
};

/**
 * Shared `localStorage` key for the Attendance-correction-link retry gap
 * fix (PR7 Task 7): `pages/my/attendance/corrections/new.tsx` writes to
 * this key when a Fleet-side link POST fails after Attendance already
 * accepted the correction, and `DriverIncidentDetail.tsx` reads it back so
 * the retry survives navigating away (or closing the app) — see both
 * files' own comments for the full story. Lives here (a non-component
 * file) rather than in `DriverIncidentDetail.tsx` itself so re-exporting
 * it does not trip `react-refresh/only-export-components`.
 */
export function pendingCorrectionStorageKey(incidentId: string): string {
  return `fleet-incident-pending-correction:${incidentId}`;
}

/** `en-ZA`, SAST — matches `AttendanceCorrectionLink.tsx`/`corrections.tsx`'s existing date conventions in this portal. */
export function formatIncidentDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

/**
 * Shared types for the vehicle telematics detectors.
 *
 * The detectors themselves land in PR4; PR3 ships only the versioned rule they
 * all read and the after-hours calendar two of them depend on.
 */

/** One version of the vehicle operational rule, as stored by migration 529. */
export interface VehicleOperationalRule {
  id: string;
  version: number;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** `HH:MM:SS` in `timezone`. The window WRAPS midnight — see `afterHours.ts`. */
  afterHoursStartTime: string;
  afterHoursEndTime: string;
  weekendsAreAfterHours: boolean;
  publicHolidaysAreAfterHours: boolean;
  theftDisplacementMeters: number;
  theftMinPositions: number;
  harshLinearG: number;
  harshLateralG: number;
  harshMinSpeedKph: number;
  speedOverLimitKph: number;
  unauthorizedStopMinutes: number;
  lostContactMinutes: number;
  idleAlertMinutes: number;
  knownSiteRadiusMeters: number;
  changeReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type VehicleRuleThresholdKey =
  | 'theftDisplacementMeters' | 'theftMinPositions' | 'harshLinearG' | 'harshLateralG'
  | 'harshMinSpeedKph' | 'speedOverLimitKph' | 'unauthorizedStopMinutes'
  | 'lostContactMinutes' | 'idleAlertMinutes' | 'knownSiteRadiusMeters';

export interface CreateVehicleRuleVersionInput extends Record<VehicleRuleThresholdKey, number> {
  timezone: string;
  effectiveFrom: string;
  afterHoursStartTime: string;
  afterHoursEndTime: string;
  weekendsAreAfterHours: boolean;
  publicHolidaysAreAfterHours: boolean;
  changeReason?: string | null;
}

/**
 * The incident types migration 529 re-versions from `critical` to `high`.
 *
 * `requiresMandatoryIncidentWhatsApp` is `severity === 'critical' && producerKind
 * === 'source_event'`, so severity is the ONLY lever that stops a detector from
 * blasting WhatsApp. `accident_sos` and `theft_after_hours_movement` are absent
 * from this list deliberately: they stay critical and stay on WhatsApp.
 *
 * Pinned against the migration SQL by `__tests__/migrationContract.test.ts`.
 */
export const REVERSIONED_TELEMATICS_INCIDENT_TYPES = [
  'severe_driving',
  'prolonged_unauthorized_stop',
  'lost_contact_moving',
  'dangerous_area_entry',
] as const;

export type ReversionedTelematicsIncidentType = (typeof REVERSIONED_TELEMATICS_INCIDENT_TYPES)[number];

/**
 * The exact `change_reason` migration 529 stamps on the rows it inserts.
 *
 * It is the rollback's only handle on "rows 529 authored": the version number
 * is not 529's to claim, because an operator may have created their own version
 * 2 of any of these types through the incident-settings UI. Pinned against both
 * SQL files by `__tests__/migrationContract.test.ts`.
 */
export const TELEMATICS_REVERSION_CHANGE_REASON =
  'Migration 529: telematics detectors report through the morning summary, not a WhatsApp blast';

/**
 * The marker migration 529 appends to a PENDING rule's `change_reason`.
 *
 * A pending row (`effective_from` in the future) cannot be closed:
 * `effective_to = now()` would be earlier than its own `effective_from` and
 * violate the range-order CHECK. 529 edits it in place instead, and this marker
 * is the only record that it did — the rollback restores by the marker alone,
 * so an operator's own pending `high` row is never touched.
 *
 * The marker CARRIES the prior flag values, e.g.
 * `529:pending{wa=false,imm=false,morn=true}`. 529's filter constrains severity
 * and nothing else, so restoring 510's seed flags on rollback would silently
 * re-arm an operator's deliberately-disabled WhatsApp.
 */
export const TELEMATICS_PENDING_REVERSION_MARKER_PREFIX = '529:pending{';

/** The exact marker shape both 529 and its rollback must agree on. */
export const TELEMATICS_PENDING_REVERSION_MARKER_PATTERN =
  String.raw`529:pending\{wa=(true|false),imm=(true|false),morn=(true|false)\}$`;

/** The marker 529 writes for a row that held `flags` before it was re-versioned. */
export function telematicsPendingMarker(flags: {
  whatsappEnabled: boolean; immediateNotification: boolean; includeInMorningSummary: boolean;
}): string {
  return `529:pending{wa=${flags.whatsappEnabled},imm=${flags.immediateNotification},morn=${flags.includeInMorningSummary}}`;
}

/**
 * The one timezone a vehicle operational rule may be versioned in.
 *
 * Migration 529 seeds version 1 with this value and every detector reads the
 * rule's own `timezone` column, so a second value would silently split the fleet
 * across two after-hours calendars. Shared by the API validator and pinned
 * against the migration's seed by `__tests__/migrationContract.test.ts`.
 */
export const VEHICLE_RULE_TIMEZONE = 'Africa/Johannesburg';

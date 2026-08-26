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
 * The marker migration 529 appends to a `change_reason` it re-versioned.
 *
 * 529 inserts no rows and closes none: it rewrites the four telematics rules in
 * place, behind a guard proving no incident references them. This marker is the
 * only record that it did, and the rollback restores by it alone — so an
 * operator's own `high` row is never touched.
 *
 * It CARRIES the prior flag values, e.g. `529:reversioned{wa=false,imm=false,
 * morn=true}`. 529's filter constrains severity and nothing else, so restoring
 * 510's seed flags on rollback would silently re-arm an operator's
 * deliberately-disabled WhatsApp.
 *
 * Anchored to the END of `change_reason`. Residual risk, accepted: prose that
 * itself ends with the exact literal would be matched. Prose that merely
 * contains it mid-string is not.
 */
export const TELEMATICS_REVERSION_MARKER_PREFIX = '529:reversioned{';

/** The exact marker shape both 529 and its rollback must agree on. */
export const TELEMATICS_REVERSION_MARKER_PATTERN =
  String.raw`529:reversioned\{wa=(true|false),imm=(true|false),morn=(true|false)\}$`;

/** The marker 529 writes for a row that held `flags` before it was re-versioned. */
export function telematicsReversionMarker(flags: {
  whatsappEnabled: boolean; immediateNotification: boolean; includeInMorningSummary: boolean;
}): string {
  return `529:reversioned{wa=${flags.whatsappEnabled},imm=${flags.immediateNotification},morn=${flags.includeInMorningSummary}}`;
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

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

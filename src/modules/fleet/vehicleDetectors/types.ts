/**
 * Shared types for the vehicle telematics detectors.
 *
 * PR3 shipped the versioned rule every detector reads and the after-hours
 * calendar two of them depend on; PR4 appends the detector-side shapes below
 * the rule ones.
 */

import type { SanitizedIncidentMetadata } from '../incidents/types';

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

/* ------------------------------------------------------------------------- *
 * PR4 — the detectors themselves.
 * ------------------------------------------------------------------------- */

/**
 * The telematics incident types PR4 actually produces.
 *
 * `dangerous_area_entry` is deliberately absent: there is no dangerous-area
 * geofence table in this database and authoring one is out of scope, so no code
 * path references it. Its rule row stays exactly as migration 529 leaves it.
 * See `src/modules/fleet/CHANGELOG.md`.
 */
export const VEHICLE_DETECTOR_IDS = [
  'theft_after_hours_movement',
  'severe_driving',
  'prolonged_unauthorized_stop',
  'lost_contact_moving',
  'accident_sos',
] as const;

export type VehicleDetectorId = (typeof VEHICLE_DETECTOR_IDS)[number];

/**
 * One position row, narrowed to what the detectors read.
 *
 * `recordedAt` is an ISO-8601 instant string, never a `Date`, so a fixture, a
 * JSON round trip and a driver row are all the same value and nothing has to be
 * formatted through UTC. Every optional field is `| null` and never
 * `| undefined`: a null `lateralG` means "this feed does not report cornering",
 * not "the vehicle cornered gently", and the g fallback depends on the
 * difference.
 */
export interface DetectorPosition {
  recordedAt: string;
  /** `fleet_vehicle_positions.provider_event_id`; the severe-driving bucket key. */
  providerEventId: string | null;
  provider: string | null;
  accountRef: string | null;
  ignition: boolean | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  linearG: number | null;
  lateralG: number | null;
  /** Provider-native event vocabulary, verbatim (migration 528). Cartrack only today. */
  providerEventType: string | null;
}

/** The vehicle a detector run is about. */
export interface DetectorVehicle {
  vehicleId: string;
  registration: string | null;
  /** `fleet_vehicles.after_hours_exempt` (migration 529) — the theft detector's opt-out. */
  afterHoursExempt: boolean;
}

/**
 * One `vehicle_assignments` row, as driver attribution reads it.
 *
 * `is_active` is deliberately absent. Every close path sets the flag and the
 * end date together, so a row is either `{active, open-ended}` or
 * `{inactive, ended}`; reading the flag would make the date bounds unreachable
 * and discard every closed row — which is precisely the history attribution
 * needs. The dates are the rule (`vehicleDriverResolver`).
 *
 * `assignmentStart`/`assignmentEnd` are `YYYY-MM-DD` STRINGS, not Dates:
 * the columns are DATE, node-postgres parses OID 1082 into a Date in the
 * server's local zone, and a Date round-tripped through UTC renders a day
 * early in SAST. `detectorQueries` therefore formats them in Postgres with
 * `to_char`, and `selectDriverAssignmentAt` compares them as strings — which
 * orders identically to dates for this format.
 */
export interface VehicleDriverAssignment {
  assignmentId: string;
  staffId: string;
  /** `first_name last_name` at read time; null only when the staff row is gone. */
  staffName: string | null;
  assignmentStart: string;
  assignmentEnd: string | null;
}

/**
 * Everything one detector needs for one vehicle on one tick.
 *
 * Assembled by `vehicleDetectorService`; every detector reads it and nothing
 * else, which is what lets each one be exercised over a fixture with no
 * database anywhere near it.
 */
export interface VehicleDetectorContext {
  vehicle: DetectorVehicle;
  /** The detection window, ascending by `recordedAt`. May be empty. */
  positions: DetectorPosition[];
  /**
   * The vehicle's newest fix regardless of the window, or null when it has
   * never reported. `lost_contact_moving` needs this: a vehicle silent for
   * three days has nothing inside the window, and that silence is the signal.
   */
  lastPosition: DetectorPosition | null;
  /**
   * p90 inter-fix gap over the last 24 h, in seconds, or null when there were
   * too few fixes to measure one. Scales `lost_contact_moving` per feed —
   * measured p90 gaps span 30 s to 160 min across the four live feeds.
   */
  gapP90Seconds: number | null;
  rule: VehicleOperationalRule;
  /** `YYYY-MM-DD` public holidays in the rule's timezone. */
  holidays: ReadonlySet<string>;
  /** The tick instant, ISO-8601. Never read from the clock inside a detector. */
  now: string;
}

/**
 * One thing a detector saw, in the shape `produceIncident` consumes.
 *
 * `metadata` is `SanitizedIncidentMetadata` — flat primitives only. A nested
 * object type-checks nowhere useful and lands in `evidence_snapshot` as
 * something the incident UI cannot render.
 */
export interface DetectedVehicleEvent {
  detectorId: VehicleDetectorId;
  /** The event instant — what the incident is dated by, not the tick time. */
  occurredAt: string;
  /** Deterministic and bucketed; see `sourceEventId.ts`. */
  sourceEventId: string;
  /** Where it happened, for project attribution. Null when the fix had no fix. */
  lat: number | null;
  lon: number | null;
  metadata: SanitizedIncidentMetadata;
}

/** Every detector has this shape. Async because one of them resolves a place in PostGIS. */
export type VehicleDetector = (context: VehicleDetectorContext) => Promise<DetectedVehicleEvent[]>;

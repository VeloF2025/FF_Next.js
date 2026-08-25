/**
 * The shapes the vehicle-day fold consumes and produces.
 *
 * Deliberately free of any database import: everything here is a plain value, so `dayFold` and
 * `coverage` can be exercised over fixtures without a Postgres anywhere near them. The repository
 * that loads these rows arrives in a later slice and depends on this file, never the reverse.
 */

/**
 * How much of a day the feed behind it could actually observe.
 *
 *   'history'  - the provider returns every event it recorded in a window.
 *   'snapshot' - the provider returns each vehicle's LAST KNOWN fix, however wide the window.
 *   'mixed'    - fixes from feeds of both kinds landed in the same vehicle-day (tracker swap).
 *   'none'     - no fixes at all.
 *
 * This is the closed set migration 528's `fleet_vehicle_daily_stats_granularity` CHECK names, and
 * `migrationContract.test.ts` fails if the two ever drift apart.
 */
export type CoverageGranularity = 'history' | 'snapshot' | 'mixed' | 'none';

/** The same set as a value, for the contract test and for exhaustive iteration. */
export const COVERAGE_GRANULARITIES: readonly CoverageGranularity[] = [
  'history',
  'snapshot',
  'mixed',
  'none',
] as const;

/**
 * One position row, narrowed to what the fold reads.
 *
 * `recordedAt` is an ISO-8601 instant string rather than a `Date` so that a fixture, a JSON
 * round-trip and a driver row are all the same thing, and so the fold has nothing to format
 * through UTC.
 *
 * Every optional-looking field is `| null` and never `| undefined`: a null lateral_g means "this
 * feed does not report cornering", not "the vehicle cornered gently", and the difference has to
 * survive into the coverage flags.
 */
export interface DayPosition {
  recordedAt: string;
  provider: string | null;
  accountRef: string | null;
  ignition: boolean | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  isSpeeding: boolean | null;
  odometerKm: number | null;
  linearG: number | null;
  lateralG: number | null;
  /** Provider-native event vocabulary, verbatim. Cartrack only today; null elsewhere. */
  providerEventType: string | null;
}

/**
 * One built trip, narrowed to what the fold reads.
 *
 * Only closed trips are useful here: an open trip has no end, so it contributes no bounded
 * ignition period. The caller filters them out; the fold ignores any that slip through.
 */
export interface DayTrip {
  ignitionOnAt: string;
  ignitionOffAt: string | null;
}

/** One row of `fleet_vehicle_daily_stats`, before it reaches the database. */
export interface VehicleDayStats {
  /** SAST calendar day as `YYYY-MM-DD`. Never a UTC day, never formatted through `toISOString`. */
  workDate: string;
  ignitionSeconds: number;
  movingSeconds: number;
  idleSeconds: number;
  distanceKm: number;
  maxSpeedKph: number | null;
  speedingEvents: number;
  speedingSeconds: number;
  harshBrakeEvents: number;
  harshAccelEvents: number;
  harshCornerEvents: number;
  firstIgnitionAt: string | null;
  lastIgnitionAt: string | null;
  positionCount: number;
  /** The LARGEST gap between consecutive fixes in the day, not the sum of gaps. */
  trackerSilenceSeconds: number;
  provider: string | null;
  accountRef: string | null;
  coverageGranularity: CoverageGranularity;
  coverageIgnition: boolean;
  coverageGforce: boolean;
  coverageProviderEvents: boolean;
  coverageComplete: boolean;
  sourceWatermark: string | null;
}

/**
 * Cartrack's own event vocabulary, restricted to the values the fold acts on.
 *
 * `HARSH_ACCELERATION` was NOT observed in 55,009 events over 7 days on 2026-08-25. It is listed
 * because the counter exists and the value is the obvious name for it if the firmware ever emits
 * one -- but nothing may assume it exists, which is why the accel counter is expected to be zero
 * on every real vehicle-day today.
 */
export const HARSH_EVENT_TYPES = {
  HARSH_BRAKING: 'brake',
  HARSH_ACCELERATION: 'accel',
  HARSH_CORNERING: 'corner',
} as const;

/** Provider events that open and close a measured idling or motion period. */
export const IDLE_START_EVENTS = ['IDLING_START'] as const;
export const IDLE_END_EVENTS = ['IDLING_END'] as const;
export const MOTION_START_EVENTS = ['MOTION_START'] as const;
export const MOTION_END_EVENTS = ['MOTION_END'] as const;

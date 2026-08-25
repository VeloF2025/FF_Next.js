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
  /**
   * The fix's identity within its feed, from `fleet_vehicle_positions.provider_event_id`.
   *
   * Load-bearing, not decorative: `recordedAt` alone does NOT identify a fix. Measured against
   * production on 2026-08-25, 164 (vehicle, recorded_at) groups over 7 days hold more than one
   * row, on all seven `cartrack/velocity` vehicles -- distinct `provider_event_id`s at the same
   * instant, sometimes disagreeing about ignition. They are real, separate events.
   *
   * So the fold cannot reject an equal timestamp, and needs this to tell a genuine tie from the
   * same fix arriving twice. Null where the feed supplies none; ingest synthesises one from
   * (account, external id, recordedAt) for those, so a null here at a repeated instant IS a
   * duplicate.
   */
  providerEventId: string | null;
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
  /**
   * Rising edges of the provider's `is_speeding` flag -- one per stretch, not one per fix.
   *
   * The edge is FOLD-GLOBAL, not per-day. A stretch of speeding that crosses SAST midnight is
   * therefore counted once, on the day it began, and the second day reports
   * `speedingSeconds > 0` with `speedingEvents === 0`. Measured: a run from 23:50 SAST at the
   * cartrack/velocity cadence yields (1 event, 600 s) then (0 events, 1,792 s).
   *
   * So these sum correctly across days, and a single day's count does NOT answer "did this
   * vehicle speed on this date". The same holds at a window boundary: a `leadIn` already
   * speeding suppresses an edge on the first fix, which is what stops an incremental build
   * re-counting one ongoing overspeed on every window.
   */
  speedingEvents: number;
  /**
   * Seconds of speeding, subject to the fold's attribution ceiling like ignition time.
   *
   * `coverageIgnition === false` is a strong signal that this duration is unmeasurable, but not a
   * guarantee that it is zero: that flag judges the day's MEDIAN gap while these seconds accrue
   * per interval. Measured: an ituran/avis-shaped day of ~35-minute gaps with one 60 s pair
   * closing on a speeding fix reports 60 here beside `coverageIgnition === false` and
   * `ignitionSeconds === 0`.
   */
  speedingSeconds: number;
  harshBrakeEvents: number;
  harshAccelEvents: number;
  harshCornerEvents: number;
  firstIgnitionAt: string | null;
  lastIgnitionAt: string | null;
  positionCount: number;
  /**
   * The LARGEST unobserved stretch in the day, not the sum of them.
   *
   * Includes the window's HEAD and TAIL -- the hours before the first fix and after the last --
   * not only the gaps between fixes. See `dayWindow.ts`.
   */
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

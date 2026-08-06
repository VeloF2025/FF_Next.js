/**
 * Every shape the parking-compliance feature exchanges, in one module that
 * imports nothing.
 *
 * Deliberately free of any transitive `pg` import: parkingQueries.ts and
 * runParkingCheck.ts both reach Postgres through @/lib/db-pool, so a PR 2/3
 * component doing a value import of a type declared in either of those files
 * pulls `pg` into the client bundle and breaks `next build` — which CI does not
 * run. Declaring the shapes here removes that trap instead of documenting it.
 */

/** Outcome of a single nightly parking check. */
export type ParkingCheckResult =
  | 'compliant'
  | 'violation'
  | 'unknown'
  | 'not_verifiable'
  | 'no_address';

export interface ParkingLocation {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface PositionFix {
  recordedAt: Date;
  lat: number;
  lon: number;
}

export interface ClassifyInput {
  /** The vehicle's active declared parking location, or null if none. */
  location: ParkingLocation | null;
  /** Whether the vehicle has an active tracker mapping. */
  hasTracker: boolean;
  /** Most recent fix at or before `checkAt`, or null if none exists. */
  lastFix: PositionFix | null;
  /** The instant the check represents (20:00 SAST). */
  checkAt: Date;
}

export interface ClassifyOutput {
  result: ParkingCheckResult;
  distanceM: number | null;
  lastFixAgeSeconds: number | null;
}

/** One active vehicle, with everything the classifier needs to judge it. */
export interface ParkingCandidate {
  vehicleId: string;
  registration: string;
  hasTracker: boolean;
  location: ParkingLocation | null;
  lastFix: PositionFix | null;
}

/** A row to be written to fleet_parking_compliance_checks. */
export interface ComplianceCheckRow {
  vehicleId: string;
  /** Snapshot of the registration, so the row survives the vehicle's deletion. */
  registration: string;
  checkDate: string;
  evaluatedAt: Date;
  parkingLocationId: string | null;
  lastFixAt: Date | null;
  lastFixLat: number | null;
  lastFixLon: number | null;
  lastFixAgeSeconds: number | null;
  distanceM: number | null;
  result: ParkingCheckResult;
}

/** What the day-slot upsert reports back about the row it wrote. */
export interface ComplianceCheckWrite {
  /** True when this call created the day's row rather than overwriting one. */
  inserted: boolean;
  /** The result this vehicle-day held before this call, or null if there was none. */
  previousResult: ParkingCheckResult | null;
}

/**
 * Per-vehicle outcome, for callers (e.g. later violation notifications) that
 * need more than the aggregate counts. Only present for vehicles whose insert
 * succeeded.
 */
export interface ParkingCheckVehicleResult {
  vehicleId: string;
  registration: string;
  result: ParkingCheckResult;
  distanceM: number | null;
  lastFixAgeSeconds: number | null;
  /** True when this was a new row for the day, false when it overwrote an earlier run's row. */
  inserted: boolean;
  /** The result this vehicle-day held before this run, or null if there was none. */
  previousResult: ParkingCheckResult | null;
  /**
   * The alerting seam: this run is the one that made the day a violation.
   *
   * NOT `inserted`. A 20:00 run against a lagging tracker feed writes
   * `unknown` as a new row; the 20:30 re-run that finally sees the fix writes
   * `violation` as an *update*, so `inserted` is false and a dedup keyed on it
   * suppresses the only alert that mattered. Keyed on the transition instead,
   * a re-run that changes nothing stays silent and a re-run that discovers a
   * violation still fires.
   */
  newViolation: boolean;
}

export interface ParkingCheckReport {
  checkDate: string;
  evaluated: number;
  counts: Record<ParkingCheckResult, number>;
  errors: number;
  results: ParkingCheckVehicleResult[];
}

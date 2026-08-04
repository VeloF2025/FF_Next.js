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

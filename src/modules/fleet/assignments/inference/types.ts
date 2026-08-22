/**
 * GPS dwell -> operational-site inference.
 *
 * The evidence half of this module is machine-written and the decision half is
 * human-written, and they live in two different tables on purpose (migration
 * 522). See proposalRepository.ts for why that split is the guard rather than a
 * convention.
 */

/** Outcome of classifying one vehicle's dwell distribution. */
export type InferenceOutcome =
  /** One project holds at least CONFIDENT_SHARE of in-AOI dwell. */
  | 'confident'
  /** Enough evidence, but no single project dominates. */
  | 'roaming'
  /** Too few pings or too few distinct days to say anything. */
  | 'insufficient_data'
  /** The vehicle reported positions, but never inside any project AOI. */
  | 'no_aoi_coverage';

/**
 * What a human settled on. `roaming_confirmed` is an answer, not a deferral:
 * it takes the vehicle out of the single-site queue without leaving it flagged.
 */
export type InferenceDecision = 'assigned' | 'rejected' | 'roaming_confirmed';

/** Whether an `assigned` decision took the machine's project or a different one. */
export type DecisionProvenance = 'inference' | 'override';

/** One project's slice of a vehicle's in-AOI dwell. */
export interface ProjectDwellShare {
  projectId: string;
  projectName: string;
  /** Fractional ping count: a ping inside N overlapping AOIs contributes 1/N. */
  pings: number;
  /** Gap-capped dwell seconds, attributed the same fractional way. */
  dwellSeconds: number;
  /** Distinct SAST calendar dates with at least one position in this AOI. */
  distinctDays: number;
}

/** Everything the classifier needs about one vehicle. */
export interface VehicleDwellSample {
  vehicleId: string;
  registration: string;
  /** Positions recorded in the window, whether or not they fell in an AOI. */
  totalPositions: number;
  shares: ProjectDwellShare[];
}

/** Tuning knobs. Defaults are justified in the module README. */
export interface InferenceThresholds {
  /** Dominant dwell share at or above which we call it `confident`. */
  confidentShare: number;
  /** Minimum in-AOI fractional pings before any call is made. */
  minPings: number;
  /** Minimum distinct SAST days in the dominant project. */
  minDistinctDays: number;
}

export const DEFAULT_THRESHOLDS: InferenceThresholds = {
  confidentShare: 0.7,
  minPings: 50,
  minDistinctDays: 3,
};

/** Longest gap between consecutive pings that still counts as dwell (seconds). */
export const DWELL_GAP_CAP_SECONDS = 900;

/** Default lookback for a recompute. */
export const DEFAULT_WINDOW_DAYS = 35;

/** Per-project evidence as persisted alongside the outcome. */
export interface EvidenceBreakdownEntry {
  projectId: string;
  projectName: string;
  pings: number;
  dwellSeconds: number;
  distinctDays: number;
  share: number;
}

export interface InferenceResult {
  vehicleId: string;
  registration: string;
  outcome: InferenceOutcome;
  /** Dominant project when `confident`, otherwise null. */
  inferredProjectId: string | null;
  inferredProjectName: string | null;
  /** Dominant project's share of in-AOI dwell, null when there is no dwell. */
  dominantShare: number | null;
  pings: number;
  dwellSeconds: number;
  distinctDays: number;
  totalPositions: number;
  breakdown: EvidenceBreakdownEntry[];
}

import {
  DEFAULT_THRESHOLDS,
  type EvidenceBreakdownEntry,
  type InferenceResult,
  type InferenceThresholds,
  type ProjectDwellShare,
  type VehicleDwellSample,
} from './types';

/**
 * Turns one vehicle's dwell distribution into a proposal outcome.
 *
 * Pure on purpose: every threshold decision is decided here and nowhere else,
 * so the boundary cases can be tested without a database.
 *
 * Ranking is by dwell seconds rather than ping count. Measured on production on
 * 2026-08-21, the tracker's median gap between pings is 11s while moving and
 * 30s (mean 389s) while stopped, so ping-share systematically under-weights the
 * thing we are actually trying to detect - standing still at a site.
 */
export function classifyVehicle(
  sample: VehicleDwellSample,
  thresholds: InferenceThresholds = DEFAULT_THRESHOLDS,
): InferenceResult {
  const totalDwell = sample.shares.reduce((total, entry) => total + entry.dwellSeconds, 0);
  const totalPings = sample.shares.reduce((total, entry) => total + entry.pings, 0);
  const breakdown = buildBreakdown(sample.shares, totalDwell);
  const dominant = breakdown[0] ?? null;
  const dominantSource = dominant
    ? sample.shares.find((entry) => entry.projectId === dominant.projectId) ?? null
    : null;

  const base = {
    vehicleId: sample.vehicleId,
    registration: sample.registration,
    inferredProjectId: null,
    inferredProjectName: null,
    dominantShare: dominant?.share ?? null,
    pings: totalPings,
    dwellSeconds: totalDwell,
    distinctDays: dominantSource?.distinctDays ?? 0,
    totalPositions: sample.totalPositions,
    breakdown,
  };

  if (!dominant || !dominantSource) {
    // A vehicle that reported nothing is a different problem from one that
    // reported plenty and never entered a project - do not conflate them.
    return { ...base, outcome: sample.totalPositions > 0 ? 'no_aoi_coverage' : 'insufficient_data' };
  }
  if (totalPings < thresholds.minPings || dominantSource.distinctDays < thresholds.minDistinctDays) {
    return { ...base, outcome: 'insufficient_data' };
  }
  if (dominant.share < thresholds.confidentShare) {
    return { ...base, outcome: 'roaming' };
  }
  return {
    ...base,
    outcome: 'confident',
    inferredProjectId: dominant.projectId,
    inferredProjectName: dominant.projectName,
  };
}

function buildBreakdown(shares: ProjectDwellShare[], totalDwell: number): EvidenceBreakdownEntry[] {
  if (totalDwell <= 0) return [];
  return shares
    .map((entry) => ({
      projectId: entry.projectId,
      projectName: entry.projectName,
      pings: entry.pings,
      dwellSeconds: entry.dwellSeconds,
      distinctDays: entry.distinctDays,
      share: entry.dwellSeconds / totalDwell,
    }))
    .sort((left, right) => right.share - left.share);
}

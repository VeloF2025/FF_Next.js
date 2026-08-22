import { log } from '@/lib/logger';
import { classifyVehicle } from './classify';
import { loadVehicleDwellSamples } from './dwellQueries';
import { saveEvidence, type InferenceWindow } from './proposalRepository';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WINDOW_DAYS,
  DWELL_GAP_CAP_SECONDS,
  type InferenceResult,
  type InferenceThresholds,
} from './types';

export interface RecomputeOptions {
  windowDays?: number;
  thresholds?: InferenceThresholds;
  /** Injectable so tests are not at the mercy of the wall clock. */
  now?: Date;
}

export interface RecomputeSummary {
  window: InferenceWindow;
  results: InferenceResult[];
  counts: Record<InferenceResult['outcome'], number>;
}

export function inferenceWindow(windowDays: number, now: Date): InferenceWindow {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Computes proposals without writing anything. Used by the read API's preview. */
export async function computeProposals(options: RecomputeOptions = {}): Promise<RecomputeSummary> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const window = inferenceWindow(windowDays, options.now ?? new Date());
  const samples = await loadVehicleDwellSamples(window.start, window.end, DWELL_GAP_CAP_SECONDS);
  const results = samples
    .map((sample) => classifyVehicle(sample, options.thresholds ?? DEFAULT_THRESHOLDS))
    .sort((left, right) => left.registration.localeCompare(right.registration));
  return { window, results, counts: tally(results) };
}

/**
 * Recomputes and persists evidence. Writes only to
 * fleet_site_inference_evidence - see proposalRepository for why that is the
 * guard on human decisions rather than a rule anyone has to remember.
 */
export async function recomputeProposals(options: RecomputeOptions = {}): Promise<RecomputeSummary> {
  const summary = await computeProposals(options);
  await saveEvidence(summary.results, summary.window);
  log.info('Recomputed fleet site inference proposals', {
    vehicles: summary.results.length,
    windowStart: summary.window.start.toISOString(),
    windowEnd: summary.window.end.toISOString(),
    ...summary.counts,
  }, 'fleet');
  return summary;
}

function tally(results: InferenceResult[]): RecomputeSummary['counts'] {
  const counts: RecomputeSummary['counts'] = {
    confident: 0, roaming: 0, insufficient_data: 0, no_aoi_coverage: 0,
  };
  for (const result of results) counts[result.outcome] += 1;
  return counts;
}

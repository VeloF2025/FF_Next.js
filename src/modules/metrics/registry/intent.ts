import { METRICS } from './index';
import type { MetricDefinition } from './types';

export type MatchResult =
  | { kind: 'exact'; metric: MetricDefinition }
  | { kind: 'ambiguous'; candidates: MetricDefinition[] }
  | { kind: 'none' };

/** Longest matching alias wins — a more specific phrase beats a generic one. */
function score(question: string, alias: string): number {
  return question.includes(alias.toLowerCase()) ? alias.length : 0;
}

/**
 * Match a question to exactly one metric, or report ambiguity.
 *
 * Never guesses: when two metrics tie, the caller receives the candidate list so
 * it can ask which was meant rather than returning a confident wrong number.
 * This replaces Cortex's `patterns=(r"pre.?prov",)`, under which any counting
 * question mentioning pre-provisions returned the added-count — including
 * questions explicitly about conversions.
 *
 * `metrics` is injectable so the tie path can be tested with a controlled pair.
 * With only three registered metrics no natural tie exists, and a test that
 * cannot reach the branch it claims to cover is not a test.
 */
export function matchMetric(
  question: string,
  metrics: readonly MetricDefinition[] = METRICS,
): MatchResult {
  const q = question.toLowerCase();

  const scored = metrics
    .map((metric) => ({
      metric,
      score: Math.max(0, ...metric.aliases.map((a) => score(q, a))),
    }))
    .filter((s) => s.score > 0);

  if (scored.length === 0) return { kind: 'none' };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score);

  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.map((t) => t.metric) };
  return { kind: 'exact', metric: best.metric };
}

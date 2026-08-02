import { describe, it, expect } from 'vitest';
import { matchMetric } from '../intent';
import type { MetricDefinition } from '../types';

/** Minimal valid definition; each test overrides only key + aliases. */
const stub: MetricDefinition = {
  key: 'stub',
  label: 'stub',
  description: 'stub',
  from: 'x src',
  measure: 'count(*)',
  dateColumn: null,
  additivity: 'additive',
  grains: ['range'],
  dimensions: [],
  aliases: [],
  cite: 'stub',
  permission: 'analytics.reports',
};

describe('matchMetric', () => {
  it('matches an unambiguous question exactly', () => {
    const r = matchMetric('how many open pre-provisions are there');
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.metric.key).toBe('pp_open_balance');
  });

  // ⚠️ Do NOT weaken this to `expect(['ambiguous','exact']).toContain(r.kind)`.
  // That assertion passes whatever happens and proves nothing — a fake test, and a
  // DGTS violation. Ambiguity reporting is the whole point of this module, so it
  // gets a real test: inject two metrics that genuinely tie.
  it('returns candidates rather than guessing when two metrics tie', () => {
    const tied = [
      { ...stub, key: 'metric_a', aliases: ['backlog'] },
      { ...stub, key: 'metric_b', aliases: ['backlog'] },
    ];
    const r = matchMetric('how many backlog', tied);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates.map((c) => c.key).sort()).toEqual(['metric_a', 'metric_b']);
    }
  });

  it('prefers the longer, more specific alias over a generic one', () => {
    const metrics = [
      { ...stub, key: 'generic', aliases: ['pre-provisions'] },
      { ...stub, key: 'specific', aliases: ['open pre-provisions'] },
    ];
    const r = matchMetric('how many open pre-provisions', metrics);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.metric.key).toBe('specific');
  });

  it('is case-insensitive on both the question and the alias', () => {
    const metrics = [{ ...stub, key: 'shouty', aliases: ['Zone Uptake'] }];
    const r = matchMetric('WHAT IS THE ZONE UPTAKE', metrics);
    expect(r.kind).toBe('exact');
  });

  it('returns none for an unrelated question so the caller can fall back to RAG', () => {
    expect(matchMetric('what did we discuss about fibre splicing').kind).toBe('none');
  });

  it('returns none rather than throwing when a metric has no aliases', () => {
    // Math.max() with no arguments is -Infinity; the 0 seed is what stops an
    // alias-less metric scoring above a real match.
    expect(matchMetric('anything at all', [stub]).kind).toBe('none');
  });
});

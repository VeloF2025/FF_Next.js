// scripts/vlm-bench/harvest/sample.ts
import * as crypto from 'crypto';

/** A harvest candidate before its image has been fetched. */
export interface Candidate {
  /** Stable natural key — the sort seed hashes this, so it must not change between runs. */
  key: string;
  stratum: 'vlm_wrong' | 'vlm_right';
}

/**
 * Deterministic stratified sample.
 *
 * Ordering is by sha256(seed + key) rather than by DB order or Math.random, so
 * the same seed always selects the same rows even as new reviews land. A run
 * that cannot be reproduced cannot be compared against, which is the whole
 * point of a sealed golden set.
 */
export function stratifiedSample<T extends Candidate>(
  candidates: readonly T[],
  seed: string,
  perStratum: Record<Candidate['stratum'], number>,
): T[] {
  const out: T[] = [];
  for (const stratum of ['vlm_wrong', 'vlm_right'] as const) {
    const want = perStratum[stratum];
    const pool = candidates
      .filter((c) => c.stratum === stratum)
      .map((c) => ({ c, h: crypto.createHash('sha256').update(`${seed}:${c.key}`).digest('hex') }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
    if (pool.length < want) {
      throw new Error(`stratum ${stratum}: only ${pool.length} candidates, need ${want}`);
    }
    out.push(...pool.slice(0, want).map((x) => x.c));
  }
  return out;
}

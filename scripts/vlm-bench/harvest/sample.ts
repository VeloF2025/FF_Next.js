// scripts/vlm-bench/harvest/sample.ts
import * as crypto from 'crypto';

/** A harvest candidate before its image has been fetched. */
export interface Candidate {
  /** Stable natural key — the sort seed hashes this, so it must not change between runs. */
  key: string;
  stratum: 'vlm_wrong' | 'vlm_right';
  /**
   * Optional second axis to balance within each stratum (serials uses
   * back/front). When present, a stratum's quota is split evenly across the
   * subgroups instead of letting the larger pool dominate.
   */
  subgroup?: string;
}

const hash = (seed: string, key: string): string =>
  crypto.createHash('sha256').update(`${seed}:${key}`).digest('hex');

/** Lowest-hash-first. Deterministic and independent of the order rows arrive in. */
function order<T extends Candidate>(pool: readonly T[], seed: string): T[] {
  return pool
    .map((c) => ({ c, h: hash(seed, c.key) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.c);
}

/** Even split of `want` across `n` buckets, remainder to the earlier ones. */
function quotas(want: number, n: number): number[] {
  const base = Math.floor(want / n);
  const extra = want % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
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
    const pool = candidates.filter((c) => c.stratum === stratum);
    const subgroups = [...new Set(pool.map((c) => c.subgroup).filter((s): s is string => Boolean(s)))].sort();

    if (subgroups.length === 0) {
      if (pool.length < want) throw new Error(`stratum ${stratum}: only ${pool.length} candidates, need ${want}`);
      out.push(...order(pool, seed).slice(0, want));
      continue;
    }

    const want_ = quotas(want, subgroups.length);
    subgroups.forEach((sg, i) => {
      const n = want_[i]!;
      const sub = pool.filter((c) => c.subgroup === sg);
      if (sub.length < n) {
        throw new Error(`stratum ${stratum}/${sg}: only ${sub.length} candidates, need ${n}`);
      }
      out.push(...order(sub, seed).slice(0, n));
    });
  }
  return out;
}

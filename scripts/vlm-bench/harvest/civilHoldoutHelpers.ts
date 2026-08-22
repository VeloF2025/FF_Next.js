// scripts/vlm-bench/harvest/civilHoldoutHelpers.ts
// Pure helpers for the civil-qa holdout draw, split out so the disjointness
// rule can be unit-tested without a DB or the sealed manifest on disk.
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

/** The ids a holdout must avoid, read off an already-sealed manifest. */
export interface SealedIds {
  photoIds: ReadonlySet<string>;
  reviewIds: ReadonlySet<string>;
}

interface SealedCase {
  expected: { photoId?: string; reviewId?: string };
}

/** Collect the photo and review ids a sealed civil-qa manifest already spent. */
export function sealedIds(cases: readonly SealedCase[]): SealedIds {
  const photoIds = new Set<string>();
  const reviewIds = new Set<string>();
  for (const c of cases) {
    if (c.expected.photoId) photoIds.add(c.expected.photoId);
    if (c.expected.reviewId) reviewIds.add(c.expected.reviewId);
  }
  return { photoIds, reviewIds };
}

/**
 * Drop every candidate that overlaps the tuning set.
 *
 * Photo ids are excluded because a case scored twice is not a holdout. Review
 * ids are excluded as well: photos from the same review are the same pole, the
 * same site, the same photographer and often the same minute, so a prompt tuned
 * on one of them has partly seen the other. The pool is ~2.5k/6k per stratum,
 * so the stricter rule costs nothing.
 */
export function excludeSealed<T extends Candidate & HarvestItem>(
  candidates: readonly T[],
  seen: SealedIds,
): T[] {
  return candidates.filter((c) => {
    const e = c.expected as { photoId?: string; reviewId?: string };
    if (e.photoId && seen.photoIds.has(e.photoId)) return false;
    if (e.reviewId && seen.reviewIds.has(e.reviewId)) return false;
    return true;
  });
}

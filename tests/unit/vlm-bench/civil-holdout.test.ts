// tests/unit/vlm-bench/civil-holdout.test.ts
// The holdout only measures anything if it is genuinely unseen. These tests
// drive the exported helpers AND assert the sealed manifests on disk, because
// the rule can be correct in code and still be violated by a stale dataset.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  excludeSealed,
  sealedIds,
} from '../../../scripts/vlm-bench/harvest/civilHoldoutHelpers';
import type { Candidate } from '../../../scripts/vlm-bench/harvest/sample';
import type { HarvestItem } from '../../../scripts/vlm-bench/harvest/seal';

type Sourced = Candidate & HarvestItem;

const cand = (photoId: string, reviewId: string): Sourced => ({
  key: photoId,
  stratum: 'vlm_wrong',
  fetchUrl: `file:///nowhere/${photoId}`,
  filename: `${photoId}.jpg`,
  expected: { photoId, reviewId },
});

const GOLDEN = path.join(__dirname, '../../../scripts/vlm-bench/datasets/golden');

interface SealedCase {
  expected: { photoId: string; reviewId: string; stratum: string; step: number };
}

const read = (dir: string): SealedCase[] =>
  JSON.parse(fs.readFileSync(path.join(GOLDEN, dir, 'cases.json'), 'utf8')) as SealedCase[];

describe('excludeSealed', () => {
  it('drops a candidate whose photo is already in the tuning set', () => {
    const seen = sealedIds([{ expected: { photoId: 'p1', reviewId: 'r9' } }]);
    const kept = excludeSealed([cand('p1', 'r1'), cand('p2', 'r2')], seen);
    expect(kept.map((c) => c.key)).toEqual(['p2']);
  });

  it('drops a DIFFERENT photo that shares a review with the tuning set', () => {
    // Same review = same pole, site and shoot; a prompt tuned on one photo has
    // partly seen the other, so photo-id disjointness alone is not enough.
    const seen = sealedIds([{ expected: { photoId: 'p1', reviewId: 'r1' } }]);
    const kept = excludeSealed([cand('p2', 'r1'), cand('p3', 'r3')], seen);
    expect(kept.map((c) => c.key)).toEqual(['p3']);
  });

  it('keeps everything when nothing has been sealed yet', () => {
    const kept = excludeSealed([cand('p1', 'r1'), cand('p2', 'r2')], sealedIds([]));
    expect(kept).toHaveLength(2);
  });
});

describe('the sealed civil-qa-holdout dataset', () => {
  const tuning = read('civil-qa');
  const holdout = read('civil-qa-holdout');

  it('has the same size and 40/40 stratification as the tuning set', () => {
    expect(holdout).toHaveLength(tuning.length);
    const wrong = holdout.filter((c) => c.expected.stratum === 'vlm_wrong');
    expect(wrong).toHaveLength(40);
    expect(holdout).toHaveLength(80);
  });

  it('shares no photo and no review with the tuning set', () => {
    const seen = sealedIds(tuning);
    const overlap = holdout.filter(
      (c) => seen.photoIds.has(c.expected.photoId) || seen.reviewIds.has(c.expected.reviewId),
    );
    expect(overlap).toEqual([]);
  });

  it('labels every case with a step the classification prompt can answer', () => {
    for (const c of holdout) {
      expect(c.expected.step).toBeGreaterThanOrEqual(0);
      expect(c.expected.step).toBeLessThanOrEqual(7);
    }
  });
});

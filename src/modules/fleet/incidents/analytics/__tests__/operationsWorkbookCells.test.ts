/**
 * `medianBucket` names the bucket the middle sample falls in — it must count
 * the sample sitting exactly on the boundary as belonging to the bucket whose
 * cumulative count reaches it, not the next one.
 */
import { describe, expect, it } from 'vitest';
import { medianBucket } from '../operationsWorkbookCells';
import type { DurationHistogram } from '../types';

function histogram(buckets: readonly number[]): DurationHistogram {
  return { sampleCount: buckets.reduce((sum, count) => sum + count, 0), sumSeconds: 0, buckets };
}

describe('medianBucket', () => {
  it('returns null when there are no samples', () => {
    expect(medianBucket(histogram([0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('names the first bucket whose cumulative count reaches the middle sample', () => {
    // sampleCount 10, middle = 5. Cumulative count lands EXACTLY on 5 inside
    // the first bucket (5 of 5 min, plus 5 more in the next), so the middle
    // sample is the 5th one — the last one in the first bucket, not the first
    // one in the second.
    expect(medianBucket(histogram([5, 5, 0, 0, 0, 0]))).toBe('up to 5 min');
  });

  it('moves to the next bucket once the cumulative count passes the middle', () => {
    expect(medianBucket(histogram([4, 6, 0, 0, 0, 0]))).toBe('5–15 min');
  });
});
